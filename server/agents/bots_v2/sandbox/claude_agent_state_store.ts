import fs from "fs/promises";
import {
    ClaudeAgentApprovalsState,
    emptyClaudeAgentApprovalsState,
} from "~/server/agents/bots_v2/sandbox/claude_agent_approvals_state.js";
import {AgentWebPageLinkKey} from "~/server/agents/web/agent_web_page_link_key.open_source.js";
import {Mutex} from "~/shared/helpers/async/mutex.open_source.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

export type ClaudeAgentState = {
    readonly sessionId: string | null;
    readonly room: ClaudeAgentRoomState | null;
    readonly approvals: ClaudeAgentApprovalsState;
};

export type ClaudeAgentRoomState = {
    readonly timeZone: TimeZone;
    readonly pageLinkKey: AgentWebPageLinkKey;
    readonly lastMessageIndex: number | "post";
};

const initialClaudeAgentState: ClaudeAgentState = {
    sessionId: null,
    room: null,
    approvals: emptyClaudeAgentApprovalsState,
};

/**
 * The container's durable state, persisted to `state.json` in the bucket mount.
 *
 * Only the container reads or writes this. The mount is an s3fs-style filesystem
 * over R2, so writes here reach the R2 object asynchronously — which is why
 * nothing outside the container makes decisions from it. The worker filters
 * approval decision webhooks from the event payload alone instead (see
 * `run_claude_agent_webhook.ts`); the debug endpoint reads `state.json` from the
 * bucket, but only to display it.
 */
export class ClaudeAgentStateStore {
    readonly #mutex = new Mutex();
    #state: ClaudeAgentState;

    private constructor(state: ClaudeAgentState) {
        this.#state = state;
    }

    static async new(span: TracerSpan) {
        return await span.withSpan("Read Claude agent state store", async () => {
            const state = await fs.readFile("/workspace/bucket/state.json", "utf8").then(
                string => JSON.parse(string),
                error => {
                    if (isObject(error) && error.code === "ENOENT") {
                        return null;
                    }
                    throw error;
                },
            );

            // Merge over the initial state so fields added after a `state.json` was written
            // (like `approvals`) get their default value.
            return new ClaudeAgentStateStore({...initialClaudeAgentState, ...(state ?? {})});
        });
    }

    get(): ClaudeAgentState {
        return this.#state;
    }

    async set(span: TracerSpan, state: Partial<ClaudeAgentState>): Promise<void> {
        await span.withSpan("Write Claude agent state store", async () => {
            await this.#mutex.withLock(async () => {
                const newState = {...this.#state, ...state};
                await fs.writeFile("/workspace/bucket/state.json", JSON.stringify(newState));
                this.#state = newState;
            });
        });
    }
}
