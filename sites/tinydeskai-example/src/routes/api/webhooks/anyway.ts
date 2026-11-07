import { createFileRoute } from '@tanstack/react-router';
import { core } from '~/core.server';

// Set the Anyway webhook URL to https://<domain>/api/webhooks/anyway; instructions in docs/anyway-payment.md.
export const Route = createFileRoute('/api/webhooks/anyway')({
  server: { handlers: { POST: ({ request }) => core.billing.webhook(request) } },
});
