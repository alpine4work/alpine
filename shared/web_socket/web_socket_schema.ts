import {ErrorSchema} from "~/shared/error/error_schema.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {WebSocketProcedureRequestId} from "~/shared/id/types/id_types.open_source.js";
import {Schema} from "~/shared/schema/schema.js";
import {TracerPropagationContextSchema} from "~/shared/tracer/tracer_propagation_context_schema.js";
import {TracerSpanPropagationContext} from "~/shared/tracer/tracer_span.open_source.js";
import {
    ServerSynchronizationCheckpoint,
    ServerSynchronizationCheckpointSchema,
} from "~/shared/web_socket/server_synchronization_checkpoint.js";
import {
    WebSocketProtocolBase,
    WebSocketProtocolEventType,
    WebSocketProtocolProceduresType,
} from "~/shared/web_socket/web_socket_protocol.js";

/**
 * The schema for a message sent from the client to the server. Messages for the
 * specific WebSocket protocol must be a union type so new messages can be added in
 * the future.
 */
export type WebSocketMessageFromClient<Protocol extends WebSocketProtocolBase> =
    | {
          readonly type: "ProcedureRequest";
          readonly requestId: WebSocketProcedureRequestId;
          readonly input: WebSocketProcedureRequestInput<WebSocketProtocolProceduresType<Protocol>>;
          readonly tracerContext: TracerSpanPropagationContext | null;
      }
    | {
          readonly type: "Ping";
          readonly tracerContext: TracerSpanPropagationContext | null;
      }
    | {
          readonly type: "SoftCloseWhileWaitingForProcedureResponses";
          readonly tracerContext: TracerSpanPropagationContext;
      };

type WebSocketProcedureRequestInput<Procedures extends {[name: string]: {input: {}; output: {}}}> =
    {
        [Name in keyof Procedures & string]: {readonly type: Name} & Procedures[Name]["input"];
    }[keyof Procedures & string];

export function createWebSocketMessageFromClientSchema<Protocol extends WebSocketProtocolBase>(
    protocol: Protocol,
): Schema<WebSocketMessageFromClient<Protocol>> {
    return Schema.union({
        ProcedureRequest: Schema.object({
            type: Schema.value("ProcedureRequest"),
            requestId: Schema.id<WebSocketProcedureRequestId>(),
            input: Schema.union(
                mapObjectValues(protocol.procedureSchemas, (procedureSchema, procedureName) =>
                    Schema.object({
                        type: Schema.value(procedureName),
                    }).merge(procedureSchema.inputSchema),
                ),
            ) as Schema<any>,
            tracerContext: TracerPropagationContextSchema.nullable(),
        }),
        Ping: Schema.object({
            type: Schema.value("Ping"),
            tracerContext: TracerPropagationContextSchema.nullable(),
        }),
        SoftCloseWhileWaitingForProcedureResponses: Schema.object({
            type: Schema.value("SoftCloseWhileWaitingForProcedureResponses"),
            tracerContext: TracerPropagationContextSchema,
        }),
    });
}

/**
 * The schema for a message sent from the server to the client. Messages for the
 * specific WebSocket protocol must be a union type so new messages can be added in
 * the future.
 */
export type WebSocketMessageFromServer<Protocol extends WebSocketProtocolBase> =
    | {
          readonly type: "ProcedureResponse";
          readonly requestId: WebSocketProcedureRequestId;
          readonly result:
              | {
                    readonly ok: true;
                    readonly output: WebSocketProcedureResponseOutput<
                        WebSocketProtocolProceduresType<Protocol>
                    >;
                }
              | {
                    readonly ok: false;
                    readonly outputType: string;
                    readonly error: unknown;
                };
      }
    | {
          readonly type: "Event";
          readonly event: WebSocketProtocolEventType<Protocol>;
      }
    | WebSocketPongMessage
    | {
          readonly type: "ClosingWithError";
          readonly error: unknown;
      }
    | {
          readonly type: "SoftCloseWhileWaitingForProcedureResponses";
      };

export type WebSocketPongMessage = {
    readonly type: "Pong";
    readonly checkpoint: ServerSynchronizationCheckpoint;
};

export const WebSocketClosingWithErrorMessageSchema = Schema.object({
    type: Schema.value("ClosingWithError"),
    error: ErrorSchema,
});

type WebSocketProcedureResponseOutput<
    Procedures extends {[name: string]: {input: {}; output: {}}},
> = {
    [Name in keyof Procedures & string]: {readonly type: Name} & Procedures[Name]["output"];
}[keyof Procedures & string];

export function createWebSocketMessageFromServerSchema<Protocol extends WebSocketProtocolBase>(
    protocol: Protocol,
): Schema<WebSocketMessageFromServer<Protocol>> {
    return Schema.union({
        ProcedureResponse: Schema.object({
            type: Schema.value("ProcedureResponse"),
            requestId: Schema.id<WebSocketProcedureRequestId>(),
            result: Schema.result(
                Schema.object({
                    ok: Schema.value(true),
                    output: Schema.union(
                        mapObjectValues(
                            protocol.procedureSchemas,
                            (procedureSchema, procedureName) =>
                                Schema.object({
                                    type: Schema.value(procedureName),
                                }).merge(procedureSchema.outputSchema),
                        ),
                    ) as Schema<any>,
                }),
                Schema.object({
                    ok: Schema.value(false),
                    outputType: Schema.string,
                    error: ErrorSchema,
                }),
            ),
        }),
        Event: Schema.object({
            type: Schema.value("Event"),
            event: protocol.eventSchema as Schema<any>,
        }),
        Pong: Schema.object({
            type: Schema.value("Pong"),
            checkpoint: ServerSynchronizationCheckpointSchema,
        }),
        ClosingWithError: WebSocketClosingWithErrorMessageSchema,
        SoftCloseWhileWaitingForProcedureResponses: Schema.object({
            type: Schema.value("SoftCloseWhileWaitingForProcedureResponses"),
        }),
    });
}
