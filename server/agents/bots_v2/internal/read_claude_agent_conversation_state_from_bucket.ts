import {claudeAgentBeforeErrorDirectoryName} from "~/server/agents/bots_v2/shared/claude_agent_before_error_directory_name.js";
import {getClaudeAgentSessionStorePartNamesToLoad} from "~/server/agents/bots_v2/shared/get_claude_agent_session_store_part_names_to_load.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";

export type ClaudeAgentConversationState = {
    /**
     * The sandbox's persisted `state.json`, falling back to the copy archived under
     * `before-error/` when a run errored, or `null` if it hasn't run yet.
     */
    readonly state: unknown;

    /** The Claude Agent SDK session the transcript below belongs to. */
    readonly sessionId: string | null;

    /**
     * The SDK project key the transcript is filed under (derived from the sandbox's
     * working directory). Surfaced only so the debugger can show where the transcript
     * came from.
     */
    readonly projectKey: string | null;

    /**
     * The raw Claude Agent SDK session transcript entries, in chronological order.
     */
    readonly items: ReadonlyArray<unknown>;
};

/**
 * Reads a sandbox's persisted conversation state directly from its R2 bucket: the
 * `state.json` and the Claude Agent SDK session transcript. This runs in
 * `AgentV2Service` against its bucket binding, so it never needs a Durable Object
 * or container running.
 *
 * Keys mirror the sandbox's mount prefix `/sandbox/{sandboxId}/`: `state.json` at
 * the root, and transcript parts at
 * `sessions/{projectKey}/{sessionId}/{part,snapshot}-*.jsonl`. Ordering those is
 * `getClaudeAgentSessionStorePartNamesToLoad()`'s job rather than a key sort — the
 * two prefixes interleave in time but not lexically. Deeper paths under
 * `sessions/` are subagent transcripts, which we skip.
 *
 * When a run errors, the sandbox moves `state.json` and `sessions/` under
 * `before-error/` before resetting the bucket (see the "nuclear option" in
 * `run_claude_agent.ts`), so we fall back to that whole archive — the debugger is
 * most useful right after an error, and the transcript has to come from the same
 * generation as the state that names its session.
 *
 * Lenient by design (this backs a debug view): a missing `state.json` means
 * "hasn't run yet" and returns nulls rather than throwing, and unparseable
 * transcript lines are dropped.
 */
export async function readClaudeAgentConversationStateFromBucket(
    bucket: R2Bucket,
    sandboxId: string,
): Promise<ClaudeAgentConversationState> {
    const sandboxPrefix = `sandbox/${sandboxId}/`;
    const beforeErrorPrefix = `${sandboxPrefix}${claudeAgentBeforeErrorDirectoryName}/`;

    // If an error was thrown during the last execution then the sandbox reset itself,
    // moving what it had to `before-error/` on the way out. Fall back to that so the
    // debugger can still show the conversation that failed.
    const [defaultStateObject, beforeErrorStateObject] = await runAllPromises([
        getBucketObject(bucket, `${sandboxPrefix}state.json`),
        getBucketObject(bucket, `${beforeErrorPrefix}state.json`),
    ]);

    const stateObject = defaultStateObject ?? beforeErrorStateObject;

    const state = stateObject === null ? null : parseJsonOrNull(await stateObject.text());
    const sessionId =
        isObject(state) && typeof state.sessionId === "string" ? state.sessionId : null;

    if (sessionId === null) {
        return {state, sessionId: null, projectKey: null, items: []};
    }

    // Read the transcript from wherever the state came from. Mixing them would pair a
    // live `state.json` with an archived transcript, or the reverse, and either way
    // the debugger would be showing two different runs at once.
    const sessionsPrefix =
        defaultStateObject === null ? `${beforeErrorPrefix}sessions/` : `${sandboxPrefix}sessions/`;

    // Keyed by part name so the ordering helper below can map its answer back to
    // object keys. It works in names, the way the sandbox's own `load()` does, and a
    // session lives under exactly one project key, so names can't collide here.
    const partKeysByName = new Map<string, string>();

    let projectKey: string | null = null;
    let cursor: string | undefined;

    do {
        const listed = await bucket.list({prefix: sessionsPrefix, cursor});

        for (const object of listed.objects) {
            // Relative to `sessions/`, the main transcript is exactly
            // `{projectKey}/{sessionId}/{part,snapshot}-*.jsonl` — three segments for our
            // session. Destructured rather than indexed so `noUncheckedIndexedAccess` is
            // happy; `rest` being empty pins it to exactly three segments (skipping
            // subagents).
            const [keyProjectKey, keySessionId, partName, ...rest] = object.key
                .slice(sessionsPrefix.length)
                .split("/");

            if (
                rest.length === 0 &&
                keySessionId === sessionId &&
                partName !== undefined &&
                partName.endsWith(".jsonl")
            ) {
                // Part names are always unique within a session, so we can use them as the map
                // key.
                partKeysByName.set(partName, object.key);
                projectKey ??= keyProjectKey ?? null;
            }
        }

        cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor !== undefined);

    // Chronological, and dropping any part a snapshot superseded. Both matter here:
    // `part-` sorts before `snapshot-` lexically no matter how new the snapshot is, so
    // sorting the keys put a resumed conversation's tail above its own history; and
    // `replaceWithSnapshot()` tolerates a failed delete, so an obsolete part can
    // outlive the snapshot that replaced it and would otherwise show up as duplicate
    // pre-surgery history.
    const partKeys = getClaudeAgentSessionStorePartNamesToLoad([...partKeysByName.keys()]).map(
        name => assertExists(partKeysByName.get(name)),
    );

    const items: Array<unknown> = [];

    for (const key of partKeys) {
        const object = await bucket.get(key);
        if (object === null) continue;

        for (const line of (await object.text()).split("\n")) {
            if (line.trim().length === 0) continue;

            const entry = parseJsonOrNull(line);
            if (entry !== null) items.push(entry);
        }
    }

    return {state, sessionId, projectKey, items};
}

/**
 * Try the object key both with and without the leading slash since the mount
 * library's key mapping isn't documented.
 */
async function getBucketObject(bucket: R2Bucket, key: string): Promise<R2ObjectBody | null> {
    return (await bucket.get(key)) ?? (await bucket.get(`/${key}`));
}

function parseJsonOrNull(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}
