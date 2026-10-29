import { createFileRoute } from '@tanstack/react-router';
import { core } from '~/core.server';

// Set the Waffo webhook URL to https://<domain>/api/webhooks/waffo; instructions in docs/waffo-payment.md.
export const Route = createFileRoute('/api/webhooks/waffo')({
  server: { handlers: { POST: ({ request }) => core.billing.webhook(request) } },
});
