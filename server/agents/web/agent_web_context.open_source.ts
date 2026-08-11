import {ApiClient} from "~/server/agents/api/api_client.open_source.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.open_source.js";
import {ApiBotWebhookRequestBody} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.open_source.js";

export type AgentWebContext = {
    readonly spaceId: SpaceId;
    readonly api: ApiClient;
    readonly storage: AgentWebSessionStorage;
    readonly span: TracerSpan;
    readonly timeZone: TimeZone;
    readonly botAccount: ApiBotWebhookRequestBody["botAccount"];
};

export type AgentWebContextWithoutStorage = Omit<AgentWebContext, "storage">;
