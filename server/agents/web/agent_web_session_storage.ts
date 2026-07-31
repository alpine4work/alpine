import {AgentWebPageMetadata} from "~/server/agents/web/agent_web_page.js";
import {AgentWebPageStoredLink} from "~/server/agents/web/agent_web_page_stored_link.js";
import {AgentWebPageStoredLinkKey} from "~/server/agents/web/agent_web_page_stored_link_key.js";
import {AgentWebTaskQueryId} from "~/server/agents/web/agent_web_task_query_cursor_hash.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {ApiTaskQueryCursor} from "~/shared/id/types/api_task_query_cursor.js";
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
     *
     * Keys must be normalized with `normalizeAgentWebPageStoredLinkPathname()`.
     * Account pathnames are printed as `/human/` or `/bot/` for the agent but they're
     * keyed under a single `/account/` namespace so that account pathnames stay unique
     * no matter how we label them. If we keyed by the printed paths directly then a
     * human named "Caleb" and a bot named "Caleb" would both get the pathname slug
     * `caleb` (as `/human/caleb` and `/bot/caleb`) and short account references like
     * `assignee=caleb` in task filters would be ambiguous.
     */
    readonly pageStoredLinkByPathname: AgentWebSessionStorageCollection<
        string,
        AgentWebPageStoredLink
    >;

    /**
     * The latest path (e.g. `/document/tech-spec`) for a given page key. If you try
     * reading a pathname for this key that's not the latest pathname then we throw an
     * error.
     *
     * Values are the agent-visible pathnames (e.g. `/human/caleb`), not the normalized
     * `pageStoredLinkByPathname` keys (e.g. `/account/caleb`), since this collection
     * doesn't need unique pathnames.
     */
    readonly latestPageStoredLinkPathnameByKey: AgentWebSessionStorageCollection<
        AgentWebPageStoredLinkKey,
        string
    >;

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
     * The full `ApiTaskQueryCursor` for a short task query cursor hash which is used
     * when printing "Next page »" links in task query pages (e.g. `?after=a1b2c3`).
     * Keys are the task query's collection or parent task ID and the short hash
     * separated by a dash.
     *
     * Full cursors are too long to print in agent web markdown so we print a short
     * hash of the cursor instead. See `createAgentWebTaskQueryCursorHash()` for how
     * the short hash is computed.
     */
    readonly taskQueryCursorByHash: AgentWebSessionStorageCollection<
        `${AgentWebTaskQueryId}-${string}`,
        ApiTaskQueryCursor
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

    /**
     * Responses for a `read` tool call based on the path that was used. Every time
     * `read` is called we re-read the link from Alpine. Then tools like `update` and
     * `scroll` use the cached response to process that result.
     *
     * Results in this cache expire (currently they expire after an hour). This forces
     * agents with long lived sessions (like OpenClaw) to re-`read` links to get the
     * latest data before `update`ing.
     *
     * The underlying storage implementation is strongly encouraged to remove entries
     * from this collection when they expire to save on storage costs.
     *
     * - `scroll` is used to paginate through the response. The initial `read` tool
     *   call truncates the response to a fixed number of bytes.
     *
     * - `update` is used to update data in Alpine. The agent uses a find-and-replace
     *   tool effectively to update content then we diff that with the cached response
     *   to determine what actually needs to be updated.
     */
    readonly readResponseByPath: AgentWebSessionStorageCollection<
        string,
        AgentWebSessionStorageReadResponse
    >;

    /**
     * If you need to manipulate a given read tool call response, it's recommended to
     * claim a lock on the path to avoid weird race conditions.
     */
    readonly readResponseMutexByPath: Map<string, Mutex>;
}

export type AgentWebSessionStorageReadResponse = {
    readonly expirationTime: Date;
    readonly pageMetadata: AgentWebPageMetadata;
    readonly response: string;
    readonly newlineIndexes: ReadonlyArray<number>;
};

/**
 * Normalizes an agent web pathname into the key format for
 * `pageStoredLinkByPathname`. Account pathnames labeled `/human/` or `/bot/` (and
 * already normalized `/account/` pathnames) all map to the same `/account/` key.
 * Every other pathname is already normalized.
 */
export function normalizeAgentWebPageStoredLinkPathname(pathname: string): string {
    const match = pathname.match(/^\/(?:human|bot)\/(.*)$/);
    if (match === null) return pathname;
    return `/account/${match[1]!}`;
}

/**
 * An interface for a single key-value collection in a key-value database. This
 * interface is a subset of `DurableObjectStorageCollection`.
 */
export interface AgentWebSessionStorageCollection<Key extends string, Value> {
    get(key: Key): Promise<Value | undefined>;
    put(key: Key, value: Value): Promise<void>;
    delete(key: Key): Promise<boolean>;
    list(options?: {prefix?: string}): Promise<Map<Key, Value>>;
}
