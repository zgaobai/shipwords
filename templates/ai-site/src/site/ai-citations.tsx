import { aiCitationLinks } from '@shipwords/core/seo';
import type { JSX } from 'react';
import { m } from '~/paraglide/messages.js';
import { getLocale } from '~/paraglide/runtime.js';
import site from '../../site.config';

function ChatGptIcon(): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 2a4 4 0 0 0-3.5 2.05A4.5 4.5 0 0 0 4 8.5c0 .76.19 1.48.52 2.11A4.5 4.5 0 0 0 4 14.5a4.5 4.5 0 0 0 4.5 4.5c.34 0 .67-.04.98-.11A4 4 0 0 0 13 22a4 4 0 0 0 3.5-2.05 4.5 4.5 0 0 0 4.5-4.45c0-.76-.19-1.48-.52-2.11A4.5 4.5 0 0 0 21 9.5a4.5 4.5 0 0 0-4.5-4.5c-.34 0-.67.04-.98.11A4 4 0 0 0 12 2Z" />
      <path d="m8.5 11.5 7 1" />
      <path d="m10 8.5 4 7" />
      <path d="m14 8.5-4 7" />
    </svg>
  );
}

function ClaudeIcon(): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ color: '#D97757' }}
    >
      <path d="M12 2v20M2 12h20M4.93 4.93l14.14 14.14M4.93 19.07 19.07 4.93M8.46 2.65l7.08 18.7M2.65 8.46l18.7 7.08M15.54 2.65 8.46 21.35M2.65 15.54l18.7-7.08" />
    </svg>
  );
}

function PerplexityIcon(): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      style={{ color: '#20B2AA' }}
    >
      <path d="M12 2v20M4 7l16 10M20 7 4 17" />
      <path d="M7 4h10v16H7z" />
    </svg>
  );
}

function GeminiIcon(): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-hidden="true"
      style={{ color: '#4285F4' }}
    >
      <path d="M12 2C12 7.52 7.52 12 2 12c5.48 0 10 4.48 10 10 0-5.52 4.48-10 10-10-5.52 0-10-4.48-10-10Z" />
    </svg>
  );
}

function GrokIcon(): JSX.Element {
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <circle cx="12" cy="12" r="9" />
      <line x1="4.93" y1="4.93" x2="19.07" y2="19.07" />
    </svg>
  );
}

const ICONS = {
  chatgpt: ChatGptIcon,
  claude: ClaudeIcon,
  perplexity: PerplexityIcon,
  gemini: GeminiIcon,
  grok: GrokIcon,
};

export function AiCitationsCard() {
  const isZh = getLocale() === 'zh';
  const prompt = isZh
    ? m.common_geo_prompt({ name: site.name, url: site.url })
    : m.common_geo_prompt({ name: site.name, url: site.url });

  const links = aiCitationLinks(site, prompt);

  return (
    <aside className="ai-citations-card" aria-label={m.common_geo_doc_tag()}>
      <div className="ai-citations-body">
        <p className="ai-citations-tag">
          {m.common_geo_doc_tag()} ·{' '}
          <a href="/llms.txt" target="_blank" rel="noreferrer" className="ai-citations-llms-link">
            {m.common_geo_doc_llms()}
          </a>
        </p>
        <p className="ai-citations-desc">{m.common_geo_doc_desc({ name: site.name })}</p>
      </div>
      <nav className="ai-citations-links" aria-label="AI citation quick actions">
        {links.map((link) => {
          const IconComponent = ICONS[link.id];
          return (
            <a
              key={link.id}
              href={link.url}
              target="_blank"
              rel="noopener noreferrer"
              className={`ai-citation-btn is-${link.id}`}
              title={`Ask ${link.name} about ${site.name}`}
              aria-label={`Ask ${link.name} about ${site.name}`}
            >
              <IconComponent />
            </a>
          );
        })}
      </nav>
    </aside>
  );
}
