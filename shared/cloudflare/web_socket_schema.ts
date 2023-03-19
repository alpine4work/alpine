import {ErrorSchema} from "~/shared/error/error_schema";
import {TraceId, TraceSpanId, WebSocketMessageId} from "~/shared/id/types/id_types";
import {Schema, UnionSchema} from "~/shared/schema/schema";
import {TracerEventFlatData} from "~/shared/tracer/helpers/build_tracer_event_flat_data";
import {TracerSpanPropagationContext} from "~/shared/tracer/tracer_span";

/**
 * The schema for a message sent from the client to the server. Messages for
 * the specific WebSocket protocol must be a union type so new messages can be
 * added in the future.
 */
export type WebSocketMessageFromClient<Message extends {type: string}> =
    | {
          readonly type: "Message";
          readonly messageId: WebSocketMessageId;
          readonly message: Message;
          readonly tracerContext: TracerSpanPropagationContext;
      }
    | {
          readonly type: "Ping";
          readonly tracerContext: TracerSpanPropagationContext;
      }
    | {
          readonly type: "SoftCloseWhileWaitingForMessageAcknowledgments";
          readonly tracerContext: TracerSpanPropagationContext;
      };

const TracerPropagationContextSchema = Schema.object({
    traceId: Schema.id<TraceId>(),
    parentId: Schema.id<TraceSpanId>(),
    data: Schema.unknown as Schema<any> as Schema<TracerEventFlatData>,
});

export function createWebSocketMessageFromClientSchema<Message extends {type: string}>(
    messageFromClientSchema: UnionSchema<Message>,
): Schema<WebSocketMessageFromClient<Message>> {
    return Schema.union({
        Message: Schema.object({
            type: Schema.value("Message"),
            messageId: Schema.id<WebSocketMessageId>(),
            message: messageFromClientSchema as Schema<any>,
            tracerContext: TracerPropagationContextSchema,
        }),
        Ping: Schema.object({
            type: Schema.value("Ping"),
            tracerContext: TracerPropagationContextSchema,
        }),
        SoftCloseWhileWaitingForMessageAcknowledgments: Schema.object({
            type: Schema.value("SoftCloseWhileWaitingForMessageAcknowledgments"),
            tracerContext: TracerPropagationContextSchema,
        }),
    });
}

/**
 * The schema for a message sent from the server to the client. Messages for
 * the specific WebSocket protocol must be a union type so new messages can be
 * added in the future.
 */
export type WebSocketMessageFromServer<Message extends {type: string}> =
    | {
          readonly type: "Message";
          readonly message: Message;
      }
    | {
          readonly type: "AcknowledgeMessage";
          readonly messageId: WebSocketMessageId;
          readonly result: {readonly ok: true} | {readonly ok: false; readonly error: unknown};
      }
    | {
          readonly type: "Pong";
      };

export function createWebSocketMessageFromServerSchema<Message extends {type: string}>(
    messageFromClientSchema: UnionSchema<Message>,
): Schema<WebSocketMessageFromServer<Message>> {
    return Schema.union({
        Message: Schema.object({
            type: Schema.value("Message"),
            message: messageFromClientSchema as Schema<any>,
        }),
        AcknowledgeMessage: Schema.object({
            type: Schema.value("AcknowledgeMessage"),
            messageId: Schema.id<WebSocketMessageId>(),
            result: Schema.result(
                Schema.object({ok: Schema.value(true)}),
                Schema.object({ok: Schema.value(false), error: ErrorSchema}),
            ),
        }),
        Pong: Schema.object({
            type: Schema.value("Pong"),
        }),
    });
}
