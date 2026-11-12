/**
 * Registry of crawler / agent identities monitored per zone. Search crawlers,
 * user-directed fetchers, browser agents and training crawlers are deliberately
 * separate classes: permissions for one never imply permissions for another.
 *
 * `userAgent` strings are used ONLY to simulate requests. Sending a crawler's
 * user-agent does not make a request come from that crawler, and Cloudflare may
 * (correctly) treat a spoofed verified-bot UA differently from the real bot.
 * `uaConfidence` records how sure we are that the string matches the provider's
 * published UA; "token" means only the product token is known — verify the full
 * string against the provider's documentation before relying on it.
 */

export type IdentityClass = "search" | "user_directed" | "browser_agent" | "training";

export interface CrawlerIdentity {
  key: string;
  provider: string;
  name: string; // user-agent product token, also the robots.txt token
  class: IdentityClass;
  purpose: string;
  userAgent: string | null; // null => robots.txt token only (no distinct crawler UA)
  uaConfidence: "published" | "token" | "robots_only";
  /** Lower-cased substrings used to detect this identity in WAF expressions / logs. */
  matchTokens: string[];
  robotsTokens: string[];
}

export const IDENTITY_CLASS_LABEL: Record<IdentityClass, string> = {
  search: "Search crawlers",
  user_directed: "User-directed fetching",
  browser_agent: "Browser & personal agents",
  training: "AI training crawlers",
};

export const CRAWLERS: CrawlerIdentity[] = [
  // Search crawlers
  {
    key: "googlebot", provider: "Google", name: "Googlebot", class: "search",
    purpose: "Google Search indexing",
    userAgent: "Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)",
    uaConfidence: "published", matchTokens: ["googlebot"], robotsTokens: ["googlebot"],
  },
  {
    key: "bingbot", provider: "Microsoft", name: "bingbot", class: "search",
    purpose: "Bing Search indexing (also feeds Copilot answers)",
    userAgent: "Mozilla/5.0 (compatible; bingbot/2.0; +http://www.bing.com/bingbot.htm)",
    uaConfidence: "published", matchTokens: ["bingbot"], robotsTokens: ["bingbot"],
  },
  {
    key: "oai-searchbot", provider: "OpenAI", name: "OAI-SearchBot", class: "search",
    purpose: "Surfacing sites in ChatGPT search results",
    userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; OAI-SearchBot/1.0; +https://openai.com/searchbot",
    uaConfidence: "published", matchTokens: ["oai-searchbot"], robotsTokens: ["oai-searchbot"],
  },
  {
    key: "claude-searchbot", provider: "Anthropic", name: "Claude-SearchBot", class: "search",
    purpose: "Indexing to improve Claude search result quality",
    userAgent: "Mozilla/5.0 (compatible; Claude-SearchBot/1.0; +https://www.anthropic.com)",
    uaConfidence: "token", matchTokens: ["claude-searchbot"], robotsTokens: ["claude-searchbot"],
  },
  {
    key: "perplexitybot", provider: "Perplexity", name: "PerplexityBot", class: "search",
    purpose: "Indexing for Perplexity search answers",
    userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; PerplexityBot/1.0; +https://perplexity.ai/perplexitybot)",
    uaConfidence: "published", matchTokens: ["perplexitybot"], robotsTokens: ["perplexitybot"],
  },
  // User-directed fetching
  {
    key: "chatgpt-user", provider: "OpenAI", name: "ChatGPT-User", class: "user_directed",
    purpose: "Fetches a page when a ChatGPT user asks about it",
    userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; ChatGPT-User/1.0; +https://openai.com/bot",
    uaConfidence: "published", matchTokens: ["chatgpt-user"], robotsTokens: ["chatgpt-user"],
  },
  {
    key: "claude-user", provider: "Anthropic", name: "Claude-User", class: "user_directed",
    purpose: "Fetches a page when a Claude user asks about it",
    userAgent: "Mozilla/5.0 (compatible; Claude-User/1.0; +https://www.anthropic.com)",
    uaConfidence: "token", matchTokens: ["claude-user"], robotsTokens: ["claude-user"],
  },
  {
    key: "perplexity-user", provider: "Perplexity", name: "Perplexity-User", class: "user_directed",
    purpose: "Fetches a page when a Perplexity user asks about it",
    userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; Perplexity-User/1.0; +https://perplexity.ai/perplexity-user)",
    uaConfidence: "token", matchTokens: ["perplexity-user"], robotsTokens: ["perplexity-user"],
  },
  // Browser & personal agents
  {
    key: "claude-agent", provider: "Anthropic", name: "Claude-Agent", class: "browser_agent",
    purpose: "Claude browser / computer-use agent acting for a user",
    userAgent: "Mozilla/5.0 (compatible; Claude-Agent/1.0; +https://www.anthropic.com)",
    uaConfidence: "token", matchTokens: ["claude-agent"], robotsTokens: ["claude-agent"],
  },
  {
    key: "chatgpt-agent", provider: "OpenAI", name: "ChatGPT Agent", class: "browser_agent",
    purpose: "ChatGPT agent browsing for a user (often a standard browser UA with signed requests)",
    userAgent: null, uaConfidence: "robots_only", matchTokens: ["chatgpt agent", "chatgpt-agent"], robotsTokens: [],
  },
  // Training crawlers
  {
    key: "gptbot", provider: "OpenAI", name: "GPTBot", class: "training",
    purpose: "Collects content that may be used to train OpenAI models",
    userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko); compatible; GPTBot/1.1; +https://openai.com/gptbot",
    uaConfidence: "published", matchTokens: ["gptbot"], robotsTokens: ["gptbot"],
  },
  {
    key: "claudebot", provider: "Anthropic", name: "ClaudeBot", class: "training",
    purpose: "Collects content that may be used to train Anthropic models",
    userAgent: "Mozilla/5.0 AppleWebKit/537.36 (KHTML, like Gecko; compatible; ClaudeBot/1.0; +claudebot@anthropic.com)",
    uaConfidence: "published", matchTokens: ["claudebot"], robotsTokens: ["claudebot"],
  },
  {
    key: "google-extended", provider: "Google", name: "Google-Extended", class: "training",
    purpose: "robots.txt control token for Gemini training use (no separate crawler UA)",
    userAgent: null, uaConfidence: "robots_only", matchTokens: ["google-extended"], robotsTokens: ["google-extended"],
  },
  {
    key: "ccbot", provider: "Common Crawl", name: "CCBot", class: "training",
    purpose: "Common Crawl open dataset (widely used for model training)",
    userAgent: "CCBot/2.0 (https://commoncrawl.org/faq/)",
    uaConfidence: "published", matchTokens: ["ccbot"], robotsTokens: ["ccbot"],
  },
];

export const BASELINE_BROWSER = {
  key: "browser",
  name: "Baseline browser",
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36",
};

export function crawlerByKey(key: string): CrawlerIdentity | undefined {
  return CRAWLERS.find((c) => c.key === key);
}

/** Identities whose names appear in a lower-cased string (expression, UA, log line). */
export function identitiesMentioned(haystack: string): CrawlerIdentity[] {
  const h = haystack.toLowerCase();
  return CRAWLERS.filter((c) => c.matchTokens.some((t) => h.includes(t)));
}
