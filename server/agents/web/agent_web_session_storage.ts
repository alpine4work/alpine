import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {DocumentCommentThreadId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Storage for web data that persists across an agent session.
 *
 * - "Agent web" is what we call the interface we provide to agents composed of
 *   heavily linked Markdown content. Links are formatted like web server URLs. To
 *   the agent it should feel like navigating Alpine content is like navigating the
 *   world wide web.
 *
 * - "Agent session" is a conversation thread with an agent. For example, in
 *   ChatGPT when you create a new chat that entire chat is one session. Each turn
 *   of the agent lives in a session and builds upon the session. After compaction
 *   the session state still remains since the agent is still working on the same
 *   task.
 *
 * This interface assumes we have EXCLUSIVE access to the underlying storage. That
 * means there must be no concurrent readers/writers to the storage besides us.
 * Given each turn of the agent is executed in sequence this is usually easy to
 * implement.
 *
 * This interface is designed to have at least implementations for:
 *
 * - Cloudflare Durable Object key-value storage
 * - DynamoDB
 *
 * You should be able to easily write an implementation of this interface for any
 * key-value storage database really.
 *
 * As of 2026-03-28, we only have a Cloudflare Durable Object implementation. But
 * we must design this interface such that we could easily add a DynamoDB
 * implementation.
 */
export interface AgentWebSessionStorage {
    /**
     * The space this session is operating in.
     */
    readonly spaceId: SpaceId;

    /**
     * When we have a session storage object we assume we have exclusive access to the
     * underlying storage. However, we may still execute JavaScript code concurrently
     * (e.g. with `runAllPromises()`) within our JavaScript thread with exclusive
     * access.
     *
     * This `mutex` helps coordinate JavaScript code running concurrently against our
     * session storage.
     */
    readonly mutex: Mutex;

    /**
     * Map of paths (e.g. `/document/tech-spec`) to the underlying resource that path
     * represents (e.g. a `DocumentId`).
     */
    readonly pageLinkByPath: AgentWebSessionStorageCollection<string, AgentWebPageLink>;

    /**
     * Map of truncated URLs (e.g. `https://example.com/a/…/f`) to the full URL (e.g.
     * `https://example.com/a/b/c/d/e/f`). The truncated URL keys include dedupe
     * numbers if applicable (e.g. `https://example.com/a/…/f#2`).
     */
    readonly urlByTruncatedUrl: AgentWebSessionStorageCollection<string, string>;

    /**
     * Map of truncated URL and full URL separated by a space (e.g.
     * `https://example.com/a/…/f https://example.com/a/b/c/d/e/f`) to the dedupe
     * number (e.g. `2`) for that URL.
     *
     * The truncated URL does _not_ include the dedupe number! This map is used to
     * determine the dedupe number for full URLs that share the same truncated URL.
     */
    readonly dedupeNumberByTruncatedUrlAndUrl: AgentWebSessionStorageCollection<
        `${string} ${string}`,
        number
    >;

    /**
     * The comment thread number for a given document comment thread which is used when
     * printing comment marks in agent web markdown (e.g. `<comment id="3">`).
     */
    readonly documentCommentThreadNumberById: AgentWebSessionStorageCollection<
        `${DocumentId}-${DocumentCommentThreadId}`,
        number
    >;

    /**
     * The `DocumentCommentThreadId` for a given document comment thread number which
     * is used when printing comment marks in agent web markdown (e.g.
     * `<comment id="3">`).
     *
     * This is the inverse of `documentCommentThreadNumberById`. Though since comment
     * thread numbers are scoped to a `DocumentId` we add the `DocumentId` to the start
     * of the key before the comment thread number.
     */
    readonly documentCommentThreadIdByNumber: AgentWebSessionStorageCollection<
        `${DocumentId}-${number}`,
        DocumentCommentThreadId
    >;

    /**
     * We truncate table widths to 2 digits of precision by default so we're not
     * sending a bunch of worthless tokens to the agent. This is a map of the truncated
     * width to the actual width value. If there are two numbers with the same
     * truncated width (e.g. 1.234 and 1.233 both truncate to 1.23) then we add a digit
     * of precision and try again (so we end storing with 1.23 for 1.234 and 1.233 for
     * 1.233).
     */
    readonly tableWidthByTruncatedWidth: AgentWebSessionStorageCollection<string, number>;

    /**
     * We truncate column widths to 2 digits of precision by default so we're not
     * sending a bunch of worthless tokens to the agent. This is a map of the truncated
     * column widths (concatenated together with commas) to the actual column width
     * values.
     *
     * Our truncation logic is similar to `tableWidthByTruncatedWidth`. We try
     * truncating with 2 digits of precision and if there's already a set of column
     * widths at that precision which are different than us then we'll retry with 3
     * digits of precision and so on until we have a unique string for our column
     * widths.
     */
    readonly tableColumnWidthsByTruncatedColumnWidths: AgentWebSessionStorageCollection<
        string,
        ReadonlyArray<number>
    >;
}

/**
 * An interface for a single key-value collection in a key-value database. This
 * interface is a subset of `DurableObjectStorageCollection`.
 */
export interface AgentWebSessionStorageCollection<Key extends string, Value> {
    get(key: Key): Promise<Value | undefined>;
    put(key: Key, value: Value): Promise<void>;
    list(options?: {prefix?: string}): Promise<Map<Key, Value>>;
}
