/**
 * The initial token limit for messages to include in context. This is based on 750
 * words which is about the average length of a Wikipedia article. Then we use the
 * [rule of thumb that 1 token is 3/4 of a word][1] so a Wikipedia article's worth
 * of context is about 1000 tokens.
 *
 * When paginating, we increase the token limit for each subsequent page by a
 * factor of 1.5. This means that the agent can "peek" into a document at the cost
 * of 1000 tokens and then make a decision to read more or not.
 *
 * [1]:
 *     https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them
 */
export const agentDocumentFirstPageTokenLimit = 1000;

/**
 * This is roughly 750 words per page based on the estimated
 * [one-hundred-tokens-is-about-75-words rule of thumb][1].
 *
 * If the average message is about 100 words, this is roughly 6-8 messages per
 * page.
 *
 * [1]:
 *     https://help.openai.com/en/articles/4936856-what-are-tokens-and-how-to-count-them
 */
export const agentMessageFirstPageTokenLimit = 1000;

/**
 * How much the token limit increases for each subsequent load of a paginated link.
 * We increase the tokens loaded on each "Next page" read since the agent is giving
 * us clear signal it needs more information in the link, we don't want the agent
 * to waste reasoning tokens continually paginating.
 */
export const agentPaginationTokenLimitGrowthFactor = 1.5;

/**
 * The initial token limit for messages to include in context. This is based on 750
 * words which is about the average length of a Wikipedia article. Then we use the
 * [rule of thumb that 1 token is 3/4 of a word][1] so a Wikipedia article's worth
 * of context is about 1000 tokens.
 *
 * [1]: https://platform.openai.com/tokenizer
 */
export const agentInitializeMessagesTokenLimit = 1500;

/**
 * The token limit to use when initializing the cursor agent. It's more than our
 * default token limit because Cursor doesn't have the ability to call tools to
 * load more context.
 */
export const cursorAgentInitializeMessagesTokenLimit = agentInitializeMessagesTokenLimit * 3;

/**
 * When the agent uses the `search_alpine` tool, we want Alpine to return up to 10
 * results.
 *
 * We originally landed on 20 results [1], but that was too many in practice -- we
 * ultimately were wasting tokens on results that were not relevant. See
 * conversation on token efficiency with respect to search results [2].
 *
 * [1]:
 *     https://app.graphite.dev/github/pr/cyberworlds/cyberworlds/702/search-alpine-chat-tool#comment-PRRC_kwDOH2ktg86Ty1oT
 * [2]:
 *     https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/posts/46s595ajdjwj1dffn3sa3xnftg?comment=13
 */
export const agentSearchResultLimit = 10;

/**
 * Unbounded, we noticed that a single user message could spend hundreds of
 * thousands of tokens. Josh sent asked two questions in a row, and those two
 * messages surpassed our organization's per-minute token limit of 500,000 tokens.
 * We've made some other changes in an attempt to improve token efficiency, but
 * we're also adding a hard limit to prevent unbounded token usage for a single
 * message [1]. If the agent needs to do more work after hitting this limit, it
 * should let the user know what work it would like to do and ask the user if it
 * should continue.
 *
 * This strategy also gives users a hint that they are using a lot of tokens. If we
 * allow the agent to consume many tokens in a single request, users may only be
 * able to send 1-2 requests per window before hitting their account-level token
 * limits. As of this writing, GPT-5.1 cost $1.25 per million input tokens, and we
 * plan on limiting a users agent cost to ~$5/month. That means that they have
 * about $0.05 to spend per window.
 *
 * A single search call costs ~1K tokens. Reading the first page of a document or
 * conversation also costs ~1K tokens. So a single user message can still pull in a
 * lot of context with a 20K token limit.
 *
 * [1]:
 *     https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/posts/46s595ajdjwj1dffn3sa3xnftg?comment=13
 */
export const agentMaxTokenCountPerWebhookCall = 20_000;
