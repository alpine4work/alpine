import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";

export type ClaudeAgentConversationState = {
    /**
     * The sandbox's persisted `state.json`, falling back to the
     * `last-known-state.json` archived when a run errored, or `null` if it hasn't run
     * yet.
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
 * `sessions/{projectKey}/{sessionId}/part-*.jsonl` appended in fixed-width epoch
 * order, so a key sort is chronological. Deeper paths under `sessions/` are
 * subagent transcripts, which we skip.
 *
 * When a run errors, the sandbox archives `state.json` as `last-known-state.json`
 * before resetting the bucket (see the "nuclear option" in `run_claude_agent.ts`),
 * so we fall back to the archive — the debugger is most useful right after an
 * error.
 *
 * Lenient by design (this backs a debug view): a missing `state.json` means
 * "hasn't run yet" and returns nulls rather than throwing, and unparseable
 * transcript lines are dropped.
 */
export async function readClaudeAgentConversationStateFromBucket(
    bucket: R2Bucket,
    sandboxId: string,
): Promise<ClaudeAgentConversationState> {
    const prefix = `sandbox/${sandboxId}/`;

    // If an error was thrown during hte last execution, we delete the `state.json` to
    // avoid corrupted state in future executions. Before we delete the `state.json`,
    // we archive it as `last-known-state.json`. When we load the state for the
    // conversation, we fallback to the last-known-state.json if the default state.json
    // is not found.
    const [defaultStateObject, lastKnownStateObject] = await runAllPromises([
        (async () =>
            (await bucket.get(`${prefix}state.json`)) ??
            (await bucket.get(`/${prefix}state.json`)))(),
        (async () =>
            (await bucket.get(`${prefix}last-known-state.json`)) ??
            (await bucket.get(`/${prefix}last-known-state.json`)))(),
    ]);

    // Try the object key both with and without the leading slash since the mount
    // library's key mapping isn't documented (matches
    // `check_claude_agent_approval_decision_event.ts`).
    const stateObject = defaultStateObject ?? lastKnownStateObject;

    const state = stateObject === null ? null : parseJsonOrNull(await stateObject.text());
    const sessionId =
        isObject(state) && typeof state.sessionId === "string" ? state.sessionId : null;

    if (sessionId === null) {
        return {state, sessionId: null, projectKey: null, items: []};
    }

    const sessionsPrefix = `${prefix}sessions/`;
    const partKeys: Array<string> = [];

    let cursor: string | undefined;

    do {
        const listed = await bucket.list({prefix: sessionsPrefix, cursor});

        for (const object of listed.objects) {
            // Relative to `sessions/`, the main transcript is exactly
            // `{projectKey}/{sessionId}/part-*.jsonl` — three segments for our session.
            // Destructured rather than indexed so `noUncheckedIndexedAccess` is happy; `rest`
            // being empty pins it to exactly three segments (skipping subagents).
            const [, keySessionId, partName, ...rest] = object.key
                .slice(sessionsPrefix.length)
                .split("/");

            if (
                rest.length === 0 &&
                keySessionId === sessionId &&
                partName !== undefined &&
                partName.endsWith(".jsonl")
            ) {
                partKeys.push(object.key);
            }
        }

        cursor = listed.truncated ? listed.cursor : undefined;
    } while (cursor !== undefined);

    partKeys.sort();

    const firstPartKey = partKeys[0];
    const projectKey =
        firstPartKey === undefined
            ? null
            : (firstPartKey.slice(sessionsPrefix.length).split("/")[0] ?? null);

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

function parseJsonOrNull(text: string): unknown {
    try {
        return JSON.parse(text);
    } catch {
        return null;
    }
}
