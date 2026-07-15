import murmurhash from "murmurhash";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {ApiTaskQueryCursor} from "~/shared/id/types/api_task_query_cursor.js";
import {TaskCollectionId, TaskId} from "~/shared/id/types/id_types.js";

export type AgentWebTaskQueryId = `TaskCollection:${TaskCollectionId}` | `Task:${TaskId}`;

/**
 * The number of base16 characters in a task query cursor hash.
 *
 * `ApiTaskQueryCursor`s are too long to print in agent web markdown. They'd
 * consume many tokens and the agent may not reliably reproduce a long cursor as it
 * paginates. So we print a short hash of the cursor and store the full cursor in
 * session storage keyed by the hash.
 *
 * We use a 24-bit hash (6 base16 characters, roughly 2-3 tokens) as a balance
 * between short pagination links and rare collisions. Collisions are resolved by
 * incrementing the hash (see `createAgentWebTaskQueryCursorHash()`) but a
 * collision means the hash for a cursor is no longer derivable from the cursor
 * alone. An agent session paginating through a large collection may store hundreds
 * of cursors per collection and a 24-bit hash keeps the chance of any collision
 * among hundreds of cursors well under 1 in 10,000. A 16-bit hash would collide
 * about 1 in 10 times at that scale.
 */
export const agentWebTaskQueryCursorHashLength = 6;

const agentWebTaskQueryCursorHashMask = 0xffffff;

/**
 * Creates a short hash for an `ApiTaskQueryCursor` and stores the full cursor in
 * session storage so `getAgentWebTaskQueryCursorForHashIfExists()` can get the
 * full cursor back when the agent paginates with the short hash.
 *
 * Hashing is deterministic: calling again with the same cursor returns the same
 * hash. If a different cursor already claimed the hash we increment the hash by
 * one (wrapping around at the end of the 24-bit hash range) until we find the
 * cursor's existing hash or a free one. Since collisions are rare, throwing away
 * the stored hashes and recreating them would produce the same values most of the
 * time.
 */
export function createAgentWebTaskQueryCursorHash(
    storage: AgentWebSessionStorage,
    queryId: AgentWebTaskQueryId,
    cursor: ApiTaskQueryCursor,
): Promise<string> {
    return storage.mutex.withLock(async () => {
        let hashNumber = murmurhash.v3(cursor) & agentWebTaskQueryCursorHashMask;

        while (true) {
            const hash = hashNumber.toString(16).padStart(agentWebTaskQueryCursorHashLength, "0");
            assert(hash.length === agentWebTaskQueryCursorHashLength);
            const storedCursor = await storage.taskQueryCursorByHash.get(`${queryId}-${hash}`);

            if (storedCursor === cursor) return hash;

            if (storedCursor === undefined) {
                await storage.taskQueryCursorByHash.put(`${queryId}-${hash}`, cursor);
                return hash;
            }

            hashNumber = (hashNumber + 1) & agentWebTaskQueryCursorHashMask;
        }
    });
}

/**
 * Gets the full `ApiTaskQueryCursor` for a short hash created by
 * `createAgentWebTaskQueryCursorHash()`. Returns `undefined` if we never created
 * the hash for this task collection.
 */
export async function getAgentWebTaskQueryCursorForHashIfExists(
    storage: AgentWebSessionStorage,
    queryId: AgentWebTaskQueryId,
    hash: string,
): Promise<ApiTaskQueryCursor | undefined> {
    return await storage.taskQueryCursorByHash.get(`${queryId}-${hash.toLowerCase()}`);
}
