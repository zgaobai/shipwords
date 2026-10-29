import type { Product } from '../site';
import type {
  CheckoutFact,
  CheckoutRequest,
  PaymentFact,
  PaymentProvider,
  SubscriptionFact,
  WebhookTarget,
  WebhookTrigger,
} from './provider';
import { WebhookSignatureError } from './provider';

// Waffo adapter (waffo.com / Waffo Pancake). Conventions:
// - Orders use Waffo Checkout / Order API;
// - Our orderId travels as merchantOrderId and paymentRequestId, and metadata carries siteId, userId, productId, orderId;
// - Webhook verification supports RSA-SHA256 (Waffo public key in PEM format) and HMAC-SHA256;
// - Webhooks trigger authoritative order/payment inquiries against Waffo's API.

export interface WaffoOptions {
  apiKey: string;
  webhookSecret: string;
  endpoint?: string;
  fetchFn?: typeof fetch;
}

const PROVIDER = 'waffo';

const ZERO_DECIMAL = new Set(['HUF', 'JPY', 'TWD']);

export function toMinor(value: string | number | undefined, currency: string): number {
  if (value == null) return 0;
  if (typeof value === 'number') {
    // If integer and large (e.g., already minor units or JPY), use it; if float, convert.
    return Number.isInteger(value) && (ZERO_DECIMAL.has(currency.toUpperCase()) || value >= 100)
      ? value
      : Math.round(value * 100);
  }
  const digits = ZERO_DECIMAL.has(currency.toUpperCase()) ? 0 : 2;
  const [whole = '0', frac = ''] = value.split('.');
  return Number(whole) * 10 ** digits + Number(`${frac}00`.slice(0, digits) || '0');
}

export function fromMinor(amount: number, currency: string): { currency: string; value: string } {
  const code = currency.toUpperCase();
  const value = ZERO_DECIMAL.has(code) ? String(amount) : (amount / 100).toFixed(2);
  return { currency: code, value };
}

function base64ToArrayBuffer(base64: string): ArrayBuffer {
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes.buffer;
}

export async function verifyWaffoSignature(
  rawBody: string,
  signature: string | null,
  secretOrPublicKey: string,
): Promise<boolean> {
  if (!signature || !secretOrPublicKey) return false;
  try {
    const encoder = new TextEncoder();
    const data = encoder.encode(rawBody);

    // If RSA Public Key (PEM formatted)
    if (secretOrPublicKey.includes('PUBLIC KEY')) {
      const cleanPem = secretOrPublicKey
        .replace(/-----BEGIN[ A-Z_-]+-----/, '')
        .replace(/-----END[ A-Z_-]+-----/, '')
        .replace(/\s+/g, '');
      const keyBuffer = base64ToArrayBuffer(cleanPem);
      const cryptoKey = await crypto.subtle.importKey(
        'spki',
        keyBuffer,
        { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
        false,
        ['verify'],
      );
      const sigBuffer = base64ToArrayBuffer(signature);
      return await crypto.subtle.verify('RSASSA-PKCS1-v1_5', cryptoKey, sigBuffer, data);
    }

    // Otherwise treat as HMAC-SHA256 secret
    const keyData = encoder.encode(secretOrPublicKey);
    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['verify'],
    );
    // Signature may be hex or base64; test hex first if length matches 64 chars
    let sigBuffer: ArrayBuffer;
    if (/^[0-9a-fA-F]{64}$/.test(signature)) {
      const bytes = new Uint8Array(32);
      for (let i = 0; i < 32; i++) {
        bytes[i] = Number.parseInt(signature.slice(i * 2, i * 2 + 2), 16);
      }
      sigBuffer = bytes.buffer;
    } else {
      sigBuffer = base64ToArrayBuffer(signature);
    }
    return await crypto.subtle.verify('HMAC', cryptoKey, sigBuffer, data);
  } catch {
    return false;
  }
}

interface WaffoOrderResponse {
  paymentRequestId?: string;
  merchantOrderId?: string;
  status?: string;
  orderAmount?: { value?: string | number; currency?: string } | number;
  amount?: number | string;
  currency?: string;
  refundAmount?: number | string;
  disputeStatus?: string;
  metadata?: {
    userId?: string;
    productId?: string;
    orderId?: string;
    siteId?: string;
  };
  paidTime?: string | number;
  createTime?: string | number;
  checkoutUrl?: string;
  paymentUrl?: string;
  receiptUrl?: string;
}

export function paymentFactFromOrder(order: WaffoOrderResponse, fetchedAt = Date.now()): PaymentFact {
  const currency = (
    (typeof order.orderAmount === 'object' ? order.orderAmount?.currency : undefined) ??
    order.currency ??
    'usd'
  ).toLowerCase();

  const rawAmount =
    (typeof order.orderAmount === 'object' ? order.orderAmount?.value : order.orderAmount) ?? order.amount;
  const amount = toMinor(rawAmount, currency);

  const status = (order.status ?? '').toUpperCase();
  const paid = status === 'SUCCESS' || status === 'PAID' || status === 'COMPLETED';

  const rawRefund = order.refundAmount;
  const amountRefunded = rawRefund ? toMinor(rawRefund, currency) : 0;

  let dispute: PaymentFact['dispute'] = null;
  const dStatus = (order.disputeStatus ?? '').toLowerCase();
  if (dStatus === 'won') dispute = 'won';
  else if (dStatus === 'lost') dispute = 'lost';
  else if (dStatus === 'open' || dStatus === 'under_review') dispute = 'open';

  const orderId = order.merchantOrderId ?? order.metadata?.orderId ?? null;
  const paymentRef = order.paymentRequestId ?? order.merchantOrderId ?? orderId ?? 'unknown';

  let paidAt: number | null = null;
  if (order.paidTime) {
    paidAt = typeof order.paidTime === 'number' ? order.paidTime : Date.parse(order.paidTime);
  } else if (order.createTime) {
    paidAt = typeof order.createTime === 'number' ? order.createTime : Date.parse(order.createTime);
  }

  return {
    provider: PROVIDER,
    paymentRef,
    chargeRef: paymentRef,
    paid,
    amount,
    currency,
    amountRefunded,
    dispute,
    metadataTrusted: true,
    userId: order.metadata?.userId ?? null,
    productId: order.metadata?.productId ?? null,
    orderId,
    subscriptionRef: null,
    periodStart: null,
    periodEnd: null,
    paidAt: Number.isNaN(paidAt) ? null : paidAt,
    fetchedAt,
  };
}

export class WaffoProvider implements PaymentProvider {
  readonly name = PROVIDER;
  private readonly endpoint: string;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly options: WaffoOptions) {
    this.endpoint = (options.endpoint ?? 'https://api.waffo.com').replace(/\/$/, '');
    this.fetchImpl = options.fetchFn ?? fetch;
  }

  async createCustomer(user: { id: string; email: string; name: string; siteId: string }): Promise<string> {
    // Waffo captures customer detail at checkout; user ID acts as customer ref
    return user.id;
  }

  async createCheckout(request: CheckoutRequest): Promise<{ url: string; checkoutRef: string }> {
    const { product, orderId, userId, siteId, successUrl, cancelUrl } = request;
    const { currency, value } = fromMinor(product.price.amount, product.price.currency);

    const payload = {
      paymentRequestId: orderId,
      merchantOrderId: orderId,
      orderAmount: { value, currency },
      productDetail: {
        productId: product.id,
        productName: product.name,
      },
      metadata: {
        siteId,
        userId,
        productId: product.id,
        orderId,
      },
      returnUrl: successUrl,
      cancelUrl,
      notifyUrl: `${new URL(successUrl).origin}/api/webhooks/waffo`,
    };

    const res = await this.fetchImpl(`${this.endpoint}/api/v1/checkout/orders`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`waffo checkout error (${res.status}): ${errText}`);
    }

    const data = (await res.json()) as {
      checkoutUrl?: string;
      paymentUrl?: string;
      url?: string;
      paymentRequestId?: string;
      merchantOrderId?: string;
      data?: { checkoutUrl?: string; paymentUrl?: string; paymentRequestId?: string };
    };

    const url =
      data.checkoutUrl ?? data.paymentUrl ?? data.url ?? data.data?.checkoutUrl ?? data.data?.paymentUrl;
    if (!url) throw new Error('waffo checkout returned no checkout url');

    return {
      url,
      checkoutRef: data.paymentRequestId ?? data.merchantOrderId ?? orderId,
    };
  }

  async parseWebhook(request: Request): Promise<WebhookTrigger> {
    const signature =
      request.headers.get('x-signature') ??
      request.headers.get('X-SIGNATURE') ??
      request.headers.get('waffo-signature');
    if (!signature) throw new WebhookSignatureError('missing waffo signature header');

    const body = await request.text();
    const verified = await verifyWaffoSignature(body, signature, this.options.webhookSecret);
    if (!verified) throw new WebhookSignatureError('invalid waffo webhook signature');

    let payload: Record<string, unknown>;
    try {
      payload = JSON.parse(body);
    } catch {
      throw new WebhookSignatureError('malformed json body');
    }

    // Handles Waffo payload wrappers: payload.body?.result, payload.result, or root
    const inner = (payload.body ?? payload) as Record<string, unknown>;
    const result = (inner.result ?? inner.data ?? inner) as Record<string, unknown>;
    const eventType = String(inner.eventType ?? payload.eventType ?? payload.type ?? 'PAYMENT_NOTIFICATION');

    const eventId = String(
      payload.eventId ?? inner.eventId ?? result.paymentRequestId ?? result.merchantOrderId ?? Date.now(),
    );

    const ref = (result.merchantOrderId ??
      result.paymentRequestId ??
      inner.merchantOrderId ??
      inner.paymentRequestId) as string | undefined;

    const target: WebhookTarget | null = ref ? { kind: 'checkout', ref } : null;

    return {
      eventId,
      type: eventType,
      target,
    };
  }

  async fetchCheckout(checkoutRef: string): Promise<CheckoutFact> {
    const payment = await this.fetchPayment(checkoutRef);
    return {
      orderId: payment?.orderId ?? checkoutRef,
      payment,
      subscription: null,
    };
  }

  async fetchPayment(paymentRef: string): Promise<PaymentFact | null> {
    const res = await this.fetchImpl(`${this.endpoint}/api/v1/order/inquiry`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.options.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        paymentRequestId: paymentRef,
        merchantOrderId: paymentRef,
      }),
    });

    if (res.status === 404) return null;
    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      throw new Error(`waffo inquiry failed (${res.status}): ${errText}`);
    }

    const json = (await res.json()) as
      | WaffoOrderResponse
      | { result?: WaffoOrderResponse; data?: WaffoOrderResponse };
    const orderData =
      'result' in json && json.result
        ? json.result
        : 'data' in json && json.data
          ? json.data
          : (json as WaffoOrderResponse);

    return paymentFactFromOrder(orderData);
  }

  async fetchPaymentByCharge(chargeRef: string): Promise<PaymentFact | null> {
    return this.fetchPayment(chargeRef);
  }

  async fetchSubscription(_subscriptionRef: string): Promise<SubscriptionFact | null> {
    return null;
  }

  async portalUrl(_customerRef: string, returnUrl: string): Promise<string> {
    return returnUrl;
  }

  async receiptUrl(paymentRef: string): Promise<string | null> {
    return `${this.endpoint}/receipt/${paymentRef}`;
  }
}
