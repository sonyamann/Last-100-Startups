// Editorial policy: what counts as a startup, and who never does.
// Changing these needs no code changes elsewhere; re-run `judge` to apply.

export const STARTUP_POLICY = `A "startup" here is a young, independent, privately held company building a product.
Count as startups: early- and growth-stage private companies (including some well-funded ones), and new commercial products launched by such companies.
NOT startups:
- public companies;
- companies that have been acquired;
- established companies at mass scale or household names, whatever their funding stage (for example Stripe, OpenAI, Anthropic, Airbnb, GitHub, Databricks, SpaceX);
- companies founded more than about 12 years ago that are long established;
- hobby or side projects, open-source projects with no company behind them, nonprofits, government bodies, universities, publications, and individual people;
- small single-purpose tools and websites rather than companies: calculators, directories, lists, rankings, comparison or lookup sites, browser extensions, one-page utilities, and similar things one person built, even if they make a little money.
A startup is a company trying to build a business with a team, a product people pay for or will pay for, and usually funding or the intent to raise it.`;

// Never shown, whatever the judgments say. Matched by normalized name.
export const DENYLIST = [
  "Google", "Alphabet", "Apple", "Amazon", "AWS", "Meta", "Facebook", "Microsoft", "Netflix", "Nvidia", "Tesla", "SpaceX",
  "OpenAI", "Anthropic", "Stripe", "Airbnb", "GitHub", "Databricks", "Salesforce", "Adobe", "Oracle", "IBM", "Intel", "AMD",
  "Uber", "Lyft", "DoorDash", "Coinbase", "Shopify", "Cloudflare", "Atlassian", "Slack", "Dropbox", "Twitter", "X", "xAI",
  "Reddit", "Pinterest", "Snap", "Spotify", "Zoom", "Twilio", "Datadog", "Snowflake", "MongoDB", "HashiCorp", "Docker",
  "GitLab", "Heroku", "DigitalOcean", "Figma", "Telegram", "Signal", "Mozilla", "Wikipedia", "Y Combinator",
  "Hacker News", "Instacart", "Robinhood", "DeepMind", "Palantir", "ByteDance", "TikTok", "Samsung", "Sony", "Intuit",
  "Valve", "Epic Games", "JetBrains",
  // Sonya's call (2026-11-04): Cursor is owned by SpaceX. (Her calls the
  // other way, Kalshi, Polymarket and DeepSeek, are in ALLOWLIST below.)
  "Cursor", "Anysphere",
  // Not companies: AI model names that slipped through extraction in M1.
  "Astra",
];

// Always count as startups, whatever Jev says (Sonya's calls, 2026-11-04).
// Hard facts still win: an allowlisted company that is acquired or public
// (by YC status or web search) is still excluded.
export const ALLOWLIST = ["Kalshi", "Polymarket", "DeepSeek"];

// Jev probability thresholds, tuned on the M1 sample (see reports/).
export const THRESHOLDS = { isCompany: 0.5, startup: 0.5 };

// YC directory statuses that disqualify a company outright.
export const EXCLUDED_YC_STATUS = new Set(["Acquired", "Public", "Inactive"]);
