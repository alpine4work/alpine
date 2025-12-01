/**
 * This is roughly 1500 words per page based on the estimated
 * [one-hundred-tokens-is-about-75-words rule of thumb][1].
 *
 * If the average paragraph / block is about 100 words, this is roughly 6-8
 * content blocks (document elements) per page.
 *
 * [1]: https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them
 */
export const agentInitialDocumentPageTokenLimitCount = 2000;

/**
 * This is roughly 750 words per page based on the estimated
 * [one-hundred-tokens-is-about-75-words rule of thumb][1].
 *
 * If the average message is about 100 words, this is roughly 6-8 messages per
 * page.
 *
 * [1]: https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them
 */
export const defaultAgentMessagePageTokenLimitCount = 1000;

/**
 * The initial token limit for messages to include in context. This is based on
 * 750 words which is about the average length of a Wikipedia article. Then we
 * use the [rule of thumb that 1 token is 3/4 of a word][1] so a Wikipedia
 * article's worth of context is about 1000 tokens. Then we multiply by 1.5 since
 * 1000 felt like too little context from basic local testing.
 *
 * [1]: https://platform.openai.com/tokenizer
 */
export const agentInitializeMessagesTokenLimitCount = 1500;

/**
 * When the agent uses the `search_alpine` tool, we want Alpine to return up to
 * 20 results. See conversation here:
 *
 * https://app.graphite.dev/github/pr/cyberworlds/cyberworlds/702/search-alpine-chat-tool#comment-PRRC_kwDOH2ktg86Ty1oT
 */
export const agentSearchAlpineResultLimitCount = 20;
