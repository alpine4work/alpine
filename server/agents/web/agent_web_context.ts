import {ApiClient} from "~/server/agents/api/api_client.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export type AgentWebContext = {
    readonly api: ApiClient;
    readonly storage: AgentWebSessionStorage;
    readonly span: TracerSpan;
};

export type AgentWebContextWithoutStorage = Omit<AgentWebContext, "storage">;
