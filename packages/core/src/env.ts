// Bindings and secrets a site Worker must provide. Configure the site's wrangler.jsonc and .dev.vars to match.

export interface CoreEnv {
  DB: D1Database;
  /** send_email binding for Cloudflare Email Service. */
  EMAIL: SendEmail;
  /** Sender address; its domain must be enabled in Email Service. */
  EMAIL_FROM: string;
  /** Overrides site.url in local dev, e.g. http://localhost:5173. */
  APP_URL?: string;

  BETTER_AUTH_SECRET: string;
  GOOGLE_CLIENT_ID?: string;
  GOOGLE_CLIENT_SECRET?: string;

  /** Configure the set matching billing.provider in site.config.ts. */
  STRIPE_SECRET_KEY?: string;
  STRIPE_WEBHOOK_SECRET?: string;
  PAYPAL_CLIENT_ID?: string;
  PAYPAL_CLIENT_SECRET?: string;
  PAYPAL_WEBHOOK_ID?: string;
  /** "sandbox" uses the PayPal sandbox; anything else uses live. */
  PAYPAL_ENV?: string;
  WAFFO_API_KEY?: string;
  WAFFO_WEBHOOK_SECRET?: string;
  WAFFO_ENDPOINT?: string;
  ANYWAY_API_KEY?: string;
  ANYWAY_WEBHOOK_SECRET?: string;
  ANYWAY_ENDPOINT?: string;

  /** reCAPTCHA (Google Cloud): the client uses the site key; the server calls createAssessment with the project ID and API key. */
  RECAPTCHA_SITE_KEY: string;
  RECAPTCHA_PROJECT_ID: string;
  RECAPTCHA_API_KEY: string;

  /** Rybbit collector endpoint (e.g. https://events.example.com/api); the site's /stats/* is proxied here. */
  RYBBIT_UPSTREAM?: string;

  /** Secret for signing the guest device cookie. */
  GUEST_COOKIE_SECRET: string;
}
