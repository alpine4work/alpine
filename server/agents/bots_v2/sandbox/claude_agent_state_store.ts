import fs from "fs/promises";
import {AgentWebPageLinkKey} from "~/server/agents/web/agent_web_page_link_key.open_source.js";
import {Mutex} from "~/shared/helpers/async/mutex.open_source.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {isObject} from "~/shared/helpers/object/is_object.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

export type ClaudeAgentState = {
    readonly sessionId: string | null;
    readonly room: ClaudeAgentRoomState | null;
};

export type ClaudeAgentRoomState = {
    readonly timeZone: TimeZone;
    readonly pageLinkKey: AgentWebPageLinkKey;
    readonly lastMessageIndex: number | "post";
};

const initialClaudeAgentState: ClaudeAgentState = {
    sessionId: null,
    room: null,
};

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

            return new ClaudeAgentStateStore(state ?? initialClaudeAgentState);
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
