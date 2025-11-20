import {ApiClient, sendPing} from "~/server/agents/api/api_client.js";
import {defaultAgentMessagePingIntervalMs} from "~/shared/agents/default_agent_message_ping_interval_ms.js";
import {ApiMessageRoomPathObject} from "~/shared/api/parse_api_path.js";
import {createInterval} from "~/shared/helpers/async/interval.js";
import {TracerBase} from "~/shared/tracer/tracer_base.js";

export function startPingingApiMessageStream(
    tracer: TracerBase,
    apiClient: ApiClient,
    roomPathObject: ApiMessageRoomPathObject,
    messageIndex: number,
) {
    return createInterval(() => {
        void sendPing(tracer, apiClient, roomPathObject, messageIndex);
    }, defaultAgentMessagePingIntervalMs);
}
