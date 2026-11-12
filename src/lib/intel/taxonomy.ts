/**
 * Provider registry and shared taxonomies. Adding a provider is a one-line change
 * here (plus optional sources in the Sources UI) — no schema change is required
 * because `provider` is stored as a validated key.
 */

export interface ProviderDefinition {
  key: string;
  name: string;
  /** Topics EightSignal monitors for this provider (shown in UI, used in AI prompt). */
  focus: string[];
  /** Keywords used by rule-based client impact matching against client tech stacks. */
  stackKeywords: string[];
  status: "active" | "planned";
}

export const PROVIDERS: ProviderDefinition[] = [
  {
    key: "cloudflare",
    name: "Cloudflare",
    focus: [
      "AI Crawler and Agent access policies", "Personal Agent controls", "WAF changes",
      "Bot management", "Security advisories", "DNS and infrastructure", "Workers",
      "AI Gateway", "Security vulnerabilities",
    ],
    stackKeywords: ["cloudflare"],
    status: "active",
  },
  {
    key: "openai",
    name: "OpenAI / ChatGPT",
    focus: [
      "ChatGPT product announcements", "ChatGPT search changes", "Model releases",
      "API developments", "Agent capabilities", "Business Hub developments",
      "Website crawling and discovery", "Developer tools", "New integrations",
    ],
    stackKeywords: ["openai", "chatgpt", "gpt"],
    status: "active",
  },
  {
    key: "anthropic",
    name: "Anthropic / Claude",
    focus: [
      "Claude model releases", "Claude Code updates", "MCP developments",
      "Browser and computer-use agents", "API changes", "Crawler identities",
      "Search and web access", "Developer ecosystem",
    ],
    stackKeywords: ["anthropic", "claude", "mcp"],
    status: "active",
  },
  { key: "google", name: "Google / Gemini", focus: ["Gemini", "Search", "Googlebot"], stackKeywords: ["google", "gemini"], status: "planned" },
  { key: "microsoft", name: "Microsoft / Copilot", focus: ["Copilot", "Bing"], stackKeywords: ["microsoft", "copilot", "azure"], status: "planned" },
  { key: "perplexity", name: "Perplexity", focus: ["Search", "Crawlers"], stackKeywords: ["perplexity"], status: "planned" },
  { key: "netlify", name: "Netlify", focus: ["Platform", "Functions"], stackKeywords: ["netlify"], status: "planned" },
  { key: "supabase", name: "Supabase", focus: ["Database", "Auth"], stackKeywords: ["supabase"], status: "planned" },
  { key: "webflow", name: "Webflow", focus: ["CMS", "Hosting"], stackKeywords: ["webflow"], status: "planned" },
  { key: "figma", name: "Figma", focus: ["Design tools"], stackKeywords: ["figma"], status: "planned" },
  { key: "make", name: "Make.com", focus: ["Automation"], stackKeywords: ["make.com", "make"], status: "planned" },
  { key: "seo", name: "Search & SEO platforms", focus: ["Search ranking", "AEO"], stackKeywords: ["seo"], status: "planned" },
  { key: "regulation", name: "AI legislation & compliance", focus: ["Regulation", "Compliance"], stackKeywords: [], status: "planned" },
  { key: "other", name: "Other", focus: [], stackKeywords: [], status: "active" },
];

export const PROVIDER_KEYS = PROVIDERS.map((p) => p.key);

export function providerName(key: string): string {
  return PROVIDERS.find((p) => p.key === key)?.name ?? key;
}

export const CATEGORIES = [
  { key: "product", label: "Product announcement" },
  { key: "model_release", label: "Model release" },
  { key: "api", label: "API change" },
  { key: "developer_tools", label: "Developer tools" },
  { key: "agents", label: "Agents & automation" },
  { key: "crawlers", label: "Crawlers & bot access" },
  { key: "search", label: "Search & discovery" },
  { key: "security", label: "Security" },
  { key: "infrastructure", label: "Infrastructure" },
  { key: "platform_change", label: "Platform change" },
  { key: "policy", label: "Policy & compliance" },
  { key: "other", label: "Other" },
] as const;
export type CategoryKey = (typeof CATEGORIES)[number]["key"];
export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key) as [CategoryKey, ...CategoryKey[]];
export function categoryLabel(key: string): string {
  return CATEGORIES.find((c) => c.key === key)?.label ?? key;
}

export const IMPACT_LEVELS = ["critical", "high", "medium", "low", "informational"] as const;
export type ImpactLevel = (typeof IMPACT_LEVELS)[number];
export const IMPACT_RANK: Record<string, number> = {
  critical: 5, high: 4, medium: 3, low: 2, informational: 1, unassessed: 0,
};

export const ITEM_STATUSES = ["new", "reviewing", "actioned", "monitoring", "archived", "dismissed"] as const;
export type ItemStatus = (typeof ITEM_STATUSES)[number];

export const DEPARTMENTS = [
  "Development", "Technical SEO", "Marketing", "Operations", "Security", "Product", "Leadership",
] as const;
export type Department = (typeof DEPARTMENTS)[number];

export const ACTION_STATUSES = ["open", "in_progress", "in_review", "completed", "dismissed"] as const;
export type ActionStatus = (typeof ACTION_STATUSES)[number];
export const ACTION_STATUS_LABEL: Record<ActionStatus, string> = {
  open: "Open", in_progress: "In Progress", in_review: "In Review", completed: "Completed", dismissed: "Dismissed",
};
export const PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];
