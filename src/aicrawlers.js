// Announced AI crawler user agents, used by the log checker (/log-checker).
//
// Source: each operator's own crawler documentation, read 2026-09-24:
//   OpenAI      https://platform.openai.com/docs/bots
//   Anthropic   https://support.anthropic.com (articles on ClaudeBot, Claude-User, Claude-SearchBot)
//   Common Crawl https://commoncrawl.org/ccbot
//   Perplexity  https://docs.perplexity.ai/guides/bots
//   Google      https://developers.google.com/search/docs/crawling-indexing/google-common-crawlers (Google-Extended)
//   Apple       https://support.apple.com/en-us/119829 (Applebot-Extended)
//   Amazon      https://developer.amazon.com/amazonbot
//   Meta        https://developers.facebook.com/docs/sharing/webmasters/web-crawlers
//   others      the operator pages linked from each crawler's user-agent string
// Cross-checked against the community list at https://github.com/ai-robots-txt/ai.robots.txt;
// nothing is copied from it. Entries are labelled only by the user agent they announce. A user
// agent can be forged, so a match says what a request claimed to be, not who sent it.
//
// token:   the string matched (case-insensitive) in the User-Agent header, and the robots.txt token.
// purpose: training | search | user fetch | crawler (operator does not separate uses) | robots.txt only
// logs:    false for tokens that exist only as robots.txt controls and never appear in a request.
export const AI_CRAWLERS = [
  { token: "GPTBot", operator: "OpenAI", purpose: "training" },
  { token: "OAI-SearchBot", operator: "OpenAI", purpose: "search" },
  { token: "ChatGPT-User", operator: "OpenAI", purpose: "user fetch" },
  { token: "ClaudeBot", operator: "Anthropic", purpose: "training" },
  { token: "Claude-SearchBot", operator: "Anthropic", purpose: "search" },
  { token: "Claude-User", operator: "Anthropic", purpose: "user fetch" },
  { token: "anthropic-ai", operator: "Anthropic", purpose: "crawler" },
  { token: "claude-web", operator: "Anthropic", purpose: "crawler" },
  { token: "CCBot", operator: "Common Crawl", purpose: "crawler" },
  { token: "PerplexityBot", operator: "Perplexity", purpose: "search" },
  { token: "Perplexity-User", operator: "Perplexity", purpose: "user fetch" },
  { token: "Bytespider", operator: "ByteDance", purpose: "crawler" },
  { token: "Amazonbot", operator: "Amazon", purpose: "crawler" },
  { token: "Meta-ExternalAgent", operator: "Meta", purpose: "training" },
  { token: "Meta-ExternalFetcher", operator: "Meta", purpose: "user fetch" },
  { token: "FacebookBot", operator: "Meta", purpose: "crawler" },
  { token: "Applebot-Extended", operator: "Apple", purpose: "robots.txt only", logs: false },
  { token: "Google-Extended", operator: "Google", purpose: "robots.txt only", logs: false },
  { token: "cohere-ai", operator: "Cohere", purpose: "crawler" },
  { token: "cohere-training-data-crawler", operator: "Cohere", purpose: "training" },
  { token: "MistralAI-User", operator: "Mistral AI", purpose: "user fetch" },
  { token: "DuckAssistBot", operator: "DuckDuckGo", purpose: "user fetch" },
  { token: "YouBot", operator: "You.com", purpose: "search" },
  { token: "AI2Bot", operator: "Allen Institute for AI", purpose: "training" },
  { token: "Diffbot", operator: "Diffbot", purpose: "crawler" },
  { token: "Timpibot", operator: "Timpi", purpose: "crawler" },
  { token: "omgili", operator: "Webz.io", purpose: "crawler" },
  { token: "ImagesiftBot", operator: "ImageSift", purpose: "crawler" },
];
