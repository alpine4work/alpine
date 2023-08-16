import {Schema} from "~/shared/schema/schema.js";
import {defineWebSocketProtocol} from "~/shared/web_socket/web_socket_protocol.js";

export const TaskRealtimeProtocol = defineWebSocketProtocol({
    procedures: {
        echo: {
            input: {string: Schema.string},
            output: {string: Schema.string},
        },
    },
    events: {},
});
