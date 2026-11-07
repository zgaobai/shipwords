import { describe, expect, it } from 'vitest';
import { AnywayProvider, toMinor } from '../src/billing/anyway';
import type { CheckoutRequest } from '../src/billing/provider';
import { WebhookSignatureError } from '../src/billing/provider';
import type { SiteConfig } from '../src/site';

const mockSite: SiteConfig = {
  id: 'test-site',
  name: 'Test Site',
  url: 'https://test.example.com',
  locales: ['en'],
  defaultLocale: 'en',
  products: [
    {
      id: 'pack_10',
      kind: 'credits',
      name: '10 credits',
      price: { amount: 999, currency: 'usd' },
      credits: 10,
      expiresDays: null,
    },
  ],
  signup: { bonusCredits: 0, bonusExpiresDays: null, bonusPerIpDaily: 0 },
  guest: { dailyPerDevice: 0, dailyPerIp: 0, dailySiteBudget: 0, minRecaptchaScore: 0.5 },
  billing: { provider: 'anyway' },
};

describe('AnywayProvider', () => {
  it('converts amounts to minor units correctly', () => {
    expect(toMinor('9.99')).toBe(999);
    expect(toMinor(999)).toBe(999);
    expect(toMinor(9.99)).toBe(999);
    expect(toMinor('100.50')).toBe(10050);
  });

  it('creates checkout session with correct parameters', async () => {
    let capturedUrl = '';
    let capturedBody: Record<string, unknown> = {};
    let capturedHeaders: Record<string, string> = {};

    const mockFetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      capturedUrl = String(input);
      capturedBody = JSON.parse(String(init?.body ?? '{}'));
      capturedHeaders = (init?.headers ?? {}) as Record<string, string>;

      return new Response(
        JSON.stringify({
          id: 'sess_123',
          url: 'https://checkout.anyway.sh/session_123',
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const provider = new AnywayProvider({
      apiKey: 'test_api_key_123',
      webhookSecret: 'whsec_test_secret',
      fetchFn: mockFetch,
    });

    const request: CheckoutRequest = {
      orderId: 'ord_98765',
      siteId: mockSite.id,
      product: mockSite.products[0]!,
      userId: 'usr_123',
      customerRef: 'usr_123',
      successUrl: 'https://test.example.com/billing/return',
      cancelUrl: 'https://test.example.com/billing/cancel',
    };

    const session = await provider.createCheckout(request);

    expect(capturedUrl).toBe('https://merchant-api-prod.anyway.sh/v1/checkout-sessions');
    expect(capturedHeaders['X-API-Key']).toBe('test_api_key_123');
    expect(capturedBody.merchantReference).toBe('ord_98765');
    expect(capturedBody.productId).toBe('pack_10');
    expect((capturedBody.metadata as Record<string, unknown>).orderId).toBe('ord_98765');
    expect(session.url).toBe('https://checkout.anyway.sh/session_123');
    expect(session.checkoutRef).toBe('sess_123');
  });

  it('verifies standard webhook signature (HMAC-SHA256)', async () => {
    const rawSecret = 'test_webhook_secret_key';
    const base64Secret = btoa(rawSecret);
    const whsec = `whsec_${base64Secret}`;

    const provider = new AnywayProvider({
      apiKey: 'test_key',
      webhookSecret: whsec,
    });

    const webhookId = 'msg_123456';
    const now = Math.floor(Date.now() / 1000).toString();
    const payload = JSON.stringify({
      event: 'order.paid',
      data: {
        id: 'ord_ext_111',
        merchantReference: 'ord_int_999',
        amount: 999,
        status: 'paid',
      },
    });

    // Compute expected HMAC-SHA256
    const signedPayload = `${webhookId}.${now}.${payload}`;
    const key = await crypto.subtle.importKey(
      'raw',
      new TextEncoder().encode(rawSecret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign'],
    );
    const sigBuffer = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(signedPayload));
    const sigBase64 = btoa(String.fromCharCode(...new Uint8Array(sigBuffer)));

    const request = new Request('https://test.example.com/api/webhooks/anyway', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'webhook-id': webhookId,
        'webhook-timestamp': now,
        'webhook-signature': `v1,${sigBase64}`,
      },
      body: payload,
    });

    const trigger = await provider.parseWebhook(request);
    expect(trigger.eventId).toBe(webhookId);
    expect(trigger.type).toBe('order.paid');
    expect(trigger.target).not.toBeNull();
    expect(trigger.target?.kind).toBe('payment');
    expect(trigger.target?.ref).toBe('ord_ext_111');
  });

  it('rejects expired webhook timestamp', async () => {
    const provider = new AnywayProvider({
      apiKey: 'test_key',
      webhookSecret: 'test_secret',
    });

    const request = new Request('https://test.example.com/api/webhooks/anyway', {
      method: 'POST',
      headers: {
        'webhook-id': 'msg_1',
        'webhook-timestamp': (Math.floor(Date.now() / 1000) - 400).toString(), // 400s ago
        'webhook-signature': 'v1,dummy',
      },
      body: '{}',
    });

    await expect(provider.parseWebhook(request)).rejects.toThrow(WebhookSignatureError);
  });

  it('fetches authoritative order details via fetchPayment()', async () => {
    const mockFetch = (async () => {
      return new Response(
        JSON.stringify({
          data: {
            id: 'ord_ext_123',
            merchantReference: 'ord_int_456',
            status: 'paid',
            amount: 999,
            currency: 'usd',
            metadata: {
              productId: 'pack_10',
              userId: 'usr_abc',
            },
          },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      );
    }) as unknown as typeof fetch;

    const provider = new AnywayProvider({
      apiKey: 'test_key',
      webhookSecret: 'test_secret',
      fetchFn: mockFetch,
    });

    const fact = await provider.fetchPayment('ord_ext_123');

    expect(fact).not.toBeNull();
    expect(fact?.paid).toBe(true);
    expect(fact?.amount).toBe(999);
    expect(fact?.currency).toBe('usd');
    expect(fact?.orderId).toBe('ord_int_456');
    expect(fact?.productId).toBe('pack_10');
    expect(fact?.userId).toBe('usr_abc');
  });
});
