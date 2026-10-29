import { describe, expect, it } from 'vitest';
import { WebhookSignatureError } from '../src/billing/provider';
import {
  fromMinor,
  paymentFactFromOrder,
  toMinor,
  verifyWaffoSignature,
  WaffoProvider,
} from '../src/billing/waffo';

describe('Waffo field mapping & currency', () => {
  it('converts amounts to minor units correctly', () => {
    expect(toMinor('19.99', 'usd')).toBe(1999);
    expect(toMinor('5', 'usd')).toBe(500);
    expect(toMinor(19.99, 'usd')).toBe(1999);
    expect(toMinor('1200', 'jpy')).toBe(1200);
    expect(toMinor(1200, 'jpy')).toBe(1200);
  });

  it('formats minor amounts to Waffo value strings', () => {
    expect(fromMinor(1999, 'usd')).toEqual({ currency: 'USD', value: '19.99' });
    expect(fromMinor(500, 'usd')).toEqual({ currency: 'USD', value: '5.00' });
    expect(fromMinor(1200, 'jpy')).toEqual({ currency: 'JPY', value: '1200' });
  });

  it('maps order responses into PaymentFact', () => {
    const fact = paymentFactFromOrder({
      paymentRequestId: 'req_123',
      merchantOrderId: 'ord_123',
      status: 'SUCCESS',
      orderAmount: { value: '9.99', currency: 'USD' },
      refundAmount: '2.00',
      disputeStatus: 'open',
      metadata: {
        userId: 'u_1',
        productId: 'pack_100',
        orderId: 'ord_123',
        siteId: 'test-site',
      },
      paidTime: '2026-10-29T12:00:00Z',
    });

    expect(fact).toMatchObject({
      provider: 'waffo',
      paymentRef: 'req_123',
      chargeRef: 'req_123',
      paid: true,
      amount: 999,
      currency: 'usd',
      amountRefunded: 200,
      dispute: 'open',
      metadataTrusted: true,
      userId: 'u_1',
      productId: 'pack_100',
      orderId: 'ord_123',
    });
  });
});

describe('Waffo signature verification', () => {
  it('verifies HMAC-SHA256 signatures correctly', async () => {
    const secret = 'my_waffo_webhook_secret_123';
    const body = JSON.stringify({ eventType: 'PAYMENT_NOTIFICATION', result: { merchantOrderId: 'ord_1' } });

    // Generate expected HMAC signature
    const encoder = new TextEncoder();
    const key = await crypto.subtle.importKey(
      'raw',
      encoder.encode(secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const signatureBuffer = await crypto.subtle.sign('HMAC', key, encoder.encode(body));
    const hexSignature = Array.from(new Uint8Array(signatureBuffer))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');

    const verified = await verifyWaffoSignature(body, hexSignature, secret);
    expect(verified).toBe(true);

    const tampered = await verifyWaffoSignature(body + ' ', hexSignature, secret);
    expect(tampered).toBe(false);
  });
});

describe('WaffoProvider', () => {
  const mockFetch: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : {};

    if (url.includes('/api/v1/checkout/orders')) {
      return new Response(
        JSON.stringify({
          checkoutUrl: 'https://checkout.waffo.com/pay/session_123',
          paymentRequestId: body.paymentRequestId,
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    if (url.includes('/api/v1/order/inquiry')) {
      return new Response(
        JSON.stringify({
          paymentRequestId: body.paymentRequestId,
          merchantOrderId: body.merchantOrderId,
          status: 'PAID',
          amount: 499,
          currency: 'USD',
          metadata: {
            userId: 'user_abc',
            productId: 'pack_200',
            orderId: body.merchantOrderId,
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }

    return new Response('not found', { status: 404 });
  };

  const provider = new WaffoProvider({
    apiKey: 'waffo_test_key',
    webhookSecret: 'test_secret',
    fetchFn: mockFetch,
  });

  it('creates checkout session url', async () => {
    const res = await provider.createCheckout({
      orderId: 'ord_test_1',
      siteId: 'my-site',
      product: {
        id: 'pack_200',
        kind: 'credits',
        name: '200 credits',
        price: { amount: 499, currency: 'usd' },
        credits: 200,
        expiresDays: null,
      },
      userId: 'user_abc',
      customerRef: 'user_abc',
      successUrl: 'https://mysite.com/billing/return',
      cancelUrl: 'https://mysite.com/pricing',
    });

    expect(res.url).toBe('https://checkout.waffo.com/pay/session_123');
    expect(res.checkoutRef).toBe('ord_test_1');
  });

  it('fetches checkout & order status', async () => {
    const checkout = await provider.fetchCheckout('ord_test_1');
    expect(checkout.orderId).toBe('ord_test_1');
    expect(checkout.payment).toMatchObject({
      paid: true,
      amount: 499,
      userId: 'user_abc',
      productId: 'pack_200',
      orderId: 'ord_test_1',
    });
  });

  it('rejects webhook with missing signature', async () => {
    const req = new Request('https://mysite.com/api/webhooks/waffo', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    await expect(provider.parseWebhook(req)).rejects.toThrow(WebhookSignatureError);
  });
});
