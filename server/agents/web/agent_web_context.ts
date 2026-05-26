import {ApiClient} from "~/server/agents/api/api_client.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {ApiAccountTargetResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

export type AgentWebContext = {
    readonly spaceId: SpaceId;
    readonly api: ApiClient;
    readonly storage: AgentWebSessionStorage;
    readonly span: TracerSpan;
    readonly timeZone: TimeZone;
    readonly botAccount: ApiAccountTargetResponse & {readonly pathname: string};
};

export type AgentWebContextWithoutStorage = Omit<AgentWebContext, "storage">;
