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

// Anyway adapter (anyway.sh).
// Features:
// - Merchant of Record (MoR) designed for developers / AI apps;
// - Checkout sessions via /v1/checkout-sessions with merchantReference and metadata;
// - Webhooks implement the Standard Webhooks spec (HMAC-SHA256, whsec_ prefix, webhook-id, webhook-timestamp, webhook-signature);
// - Authoritative order retrieval via /v1/orders/{id}.

export interface AnywayOptions {
  apiKey: string;
  webhookSecret: string;
  endpoint?: string;
  fetchFn?: typeof fetch;
}

const PROVIDER = 'anyway';
const DEFAULT_ENDPOINT = 'https://merchant-api-prod.anyway.sh';

export function toMinor(value: string | number | undefined): number {
  if (value == null) return 0;
  if (typeof value === 'number') {
    return Number.isInteger(value) && value >= 100 ? value : Math.round(value * 100);
  }
  const [whole = '0', frac = ''] = value.split('.');
  return Number(whole) * 100 + Number(`${frac}00`.slice(0, 2) || '0');
}

function base64ToUint8Array(base64: string): Uint8Array {
  const binary = atob(base64.replace(/\s+/g, ''));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function bufferToHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a[i]! ^ b[i]!;
  }
  return diff === 0;
}

interface AnywayOrderResponse {
  id?: string;
  merchantReference?: string;
  status?: string;
  amount?: number | string;
  totalAmount?: number | string;
  amountTotal?: number | string;
  currency?: string;
  refundAmount?: number | string;
  disputeStatus?: string;
  metadata?: {
    userId?: string;
    productId?: string;
    orderId?: string;
    siteId?: string;
  };
  merchantMetadata?: {
    userId?: string;
    productId?: string;
    orderId?: string;
    siteId?: string;
  };
  paidTime?: string | number;
  paidAt?: string | number;
  createTime?: string | number;
  receiptUrl?: string;
}

export function paymentFactFromAnywayOrder(order: AnywayOrderResponse, fetchedAt = Date.now()): PaymentFact {
  const currency = String(order.currency ?? 'usd').toLowerCase();
  const rawAmount = order.totalAmount ?? order.amountTotal ?? order.amount;
  const amount = toMinor(rawAmount);

  const status = (order.status ?? '').toLowerCase();
  const paid = status === 'paid' || status === 'succeeded' || status === 'completed';

  const rawRefund = order.refundAmount;
  const amountRefunded = rawRefund ? toMinor(rawRefund) : 0;

  let dispute: PaymentFact['dispute'] = null;
  const dStatus = (order.disputeStatus ?? '').toLowerCase();
  if (dStatus === 'won') dispute = 'won';
  else if (dStatus === 'lost') dispute = 'lost';
  else if (dStatus === 'open' || dStatus === 'under_review') dispute = 'open';

  const metadata = order.metadata ?? order.merchantMetadata ?? {};
  const orderId = order.merchantReference ?? metadata.orderId ?? null;
  const paymentRef = order.id ?? orderId ?? 'unknown';

  let paidAt: number | null = null;
  const rawPaidTime = order.paidAt ?? order.paidTime;
  if (rawPaidTime) {
    paidAt = typeof rawPaidTime === 'number' ? rawPaidTime : Date.parse(rawPaidTime);
    if (Number.isNaN(paidAt)) paidAt = null;
  }

  return {
    provider: PROVIDER,
    paymentRef,
    chargeRef: null,
    paid,
    amount,
    currency,
    amountRefunded,
    dispute,
    metadataTrusted: true,
    userId: metadata.userId ?? null,
    productId: metadata.productId ?? null,
    orderId,
    subscriptionRef: null,
    periodStart: null,
    periodEnd: null,
    paidAt,
    fetchedAt,
  };
}

export class AnywayProvider implements PaymentProvider {
  readonly name = PROVIDER;
  private readonly apiKey: string;
  private readonly webhookSecret: string;
  private readonly endpoint: string;
  private readonly fetchFn: typeof fetch;

  constructor(options: AnywayOptions) {
    this.apiKey = options.apiKey;
    this.webhookSecret = options.webhookSecret;
    this.endpoint = (options.endpoint ?? DEFAULT_ENDPOINT).replace(/\/+$/, '');
    this.fetchFn = options.fetchFn ?? fetch;
  }

  async createCustomer(user: { id: string; email: string; name: string; siteId: string }): Promise<string> {
    return user.id;
  }

  async createCheckout(request: CheckoutRequest): Promise<{ url: string; checkoutRef: string }> {
    const { siteId, product, userId, orderId, successUrl, cancelUrl } = request;

    const payload: Record<string, unknown> = {
      merchantReference: orderId,
      productId: product.refs?.anyway ?? product.id,
      returnUrl: successUrl,
      cancelUrl,
      metadata: {
        siteId,
        userId,
        productId: product.id,
        orderId,
      },
    };

    const res = await this.fetchFn(`${this.endpoint}/v1/checkout-sessions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-API-Key': this.apiKey,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`anyway checkout session creation failed (${res.status}): ${text}`);
    }

    const data = (await res.json()) as { id?: string; url?: string; checkoutUrl?: string };
    const checkoutUrl = data.url ?? data.checkoutUrl;
    if (!checkoutUrl) {
      throw new Error('anyway checkout session did not return a checkout url');
    }

    return {
      url: checkoutUrl,
      checkoutRef: data.id ?? orderId,
    };
  }

  async parseWebhook(request: Request): Promise<WebhookTrigger> {
    const rawBody = await request.text();
    const webhookId = request.headers.get('webhook-id');
    const webhookTimestamp = request.headers.get('webhook-timestamp');
    const webhookSignature = request.headers.get('webhook-signature');

    if (!webhookSignature || !webhookId || !webhookTimestamp) {
      throw new WebhookSignatureError('missing anyway webhook signature headers');
    }

    // Protect against replay attacks (5 minutes tolerance)
    const now = Math.floor(Date.now() / 1000);
    const ts = Number.parseInt(webhookTimestamp, 10);
    if (Number.isNaN(ts) || Math.abs(now - ts) > 300) {
      throw new WebhookSignatureError('anyway webhook timestamp out of tolerance window');
    }

    // Standard Webhooks format:
    // Signed payload is: `${webhookId}.${webhookTimestamp}.${rawBody}`
    const signedPayload = `${webhookId}.${webhookTimestamp}.${rawBody}`;
    const cleanSecret = this.webhookSecret.startsWith('whsec_')
      ? this.webhookSecret.slice(6)
      : this.webhookSecret;

    let secretKeyBytes: Uint8Array;
    try {
      secretKeyBytes = base64ToUint8Array(cleanSecret);
    } catch {
      secretKeyBytes = new TextEncoder().encode(cleanSecret);
    }

    const keyBuffer = secretKeyBytes.buffer.slice(
      secretKeyBytes.byteOffset,
      secretKeyBytes.byteOffset + secretKeyBytes.byteLength,
    ) as ArrayBuffer;

    const cryptoKey = await crypto.subtle.importKey(
      'raw',
      keyBuffer,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );

    const expectedSigBuffer = await crypto.subtle.sign(
      'HMAC',
      cryptoKey,
      new TextEncoder().encode(signedPayload),
    );
    const expectedBase64 = btoa(String.fromCharCode(...new Uint8Array(expectedSigBuffer)));
    const expectedHex = bufferToHex(expectedSigBuffer);

    // webhook-signature header can contain multiple space-separated signatures, e.g. "v1,abc v1,def"
    const signatures = webhookSignature.split(' ');
    let verified = false;

    for (const sig of signatures) {
      const parts = sig.split(',');
      const signatureValue = parts.length > 1 ? parts[1] : parts[0];
      if (!signatureValue) continue;

      if (
        timingSafeEqual(new TextEncoder().encode(signatureValue), new TextEncoder().encode(expectedBase64)) ||
        timingSafeEqual(new TextEncoder().encode(signatureValue), new TextEncoder().encode(expectedHex))
      ) {
        verified = true;
        break;
      }
    }

    if (!verified) {
      throw new WebhookSignatureError('invalid anyway webhook signature');
    }

    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(rawBody);
    } catch {
      throw new WebhookSignatureError('invalid json in anyway webhook payload');
    }

    const event = String(parsed.event ?? parsed.type ?? '');
    const data = (parsed.data ?? parsed) as Record<string, unknown>;
    const orderObj = (data.object ?? data.order ?? data) as Record<string, unknown>;
    const externalId = String(orderObj.id ?? orderObj.orderId ?? parsed.id ?? '');

    let target: WebhookTarget | null = null;
    if (externalId) {
      target = { kind: 'payment', ref: externalId };
    }

    return {
      eventId: webhookId,
      type: event,
      target,
    };
  }

  async fetchCheckout(checkoutRef: string): Promise<CheckoutFact> {
    const payment = await this.fetchPayment(checkoutRef);
    return {
      orderId: payment?.orderId ?? null,
      payment,
      subscription: null,
    };
  }

  async fetchPayment(paymentRef: string): Promise<PaymentFact | null> {
    if (!paymentRef) return null;

    const res = await this.fetchFn(`${this.endpoint}/v1/orders/${encodeURIComponent(paymentRef)}`, {
      headers: {
        'X-API-Key': this.apiKey,
      },
    });

    if (res.status === 404) return null;
    if (!res.ok) {
      const text = await res.text();
      throw new Error(`anyway order query failed (${res.status}): ${text}`);
    }

    const body = (await res.json()) as Record<string, unknown>;
    const data = (body.data ?? body) as Record<string, unknown> as AnywayOrderResponse;
    return paymentFactFromAnywayOrder(data);
  }

  async fetchPaymentByCharge(_chargeRef: string): Promise<PaymentFact | null> {
    return null;
  }

  async fetchSubscription(_subscriptionRef: string): Promise<SubscriptionFact | null> {
    return null;
  }

  async portalUrl(_customerRef: string, _returnUrl: string): Promise<string> {
    throw new Error('anyway does not provide a customer portal');
  }

  async receiptUrl(paymentRef: string): Promise<string | null> {
    const fact = await this.fetchPayment(paymentRef);
    if (!fact) return null;
    const raw = fact as { rawData?: { receiptUrl?: string; data?: { receiptUrl?: string } } };
    return raw.rawData?.receiptUrl ?? raw.rawData?.data?.receiptUrl ?? null;
  }
}
