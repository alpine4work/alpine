import {Schema, SchemaType} from "~/shared/schema/schema.js";

const WebWorkerRpcRequestMessageSchema = Schema.object({
    type: Schema.value("request"),
    callId: Schema.integer,
    method: Schema.string,
    input: Schema.unknown(),
});

const WebWorkerRpcResponseMessageSchema = Schema.object({
    type: Schema.value("response"),
    callId: Schema.integer,
    output: Schema.unknown(),
});

const WebWorkerRpcErrorMessageSchema = Schema.object({
    type: Schema.value("error"),
    callId: Schema.integer,
    message: Schema.string,
});

/**
 * Schema for messages sent between {@link WebWorkerRpc} instances. Discriminated
 * by `type`:
 *
 * - `"request"` — a method call from caller to callee.
 * - `"response"` — a successful return value from callee to caller.
 * - `"error"` — a failed method call from callee to caller.
 *
 * The `callId` ties a response/error back to its originating request.
 */
export const webWorkerRpcMessageSchema = Schema.union({
    request: WebWorkerRpcRequestMessageSchema,
    response: WebWorkerRpcResponseMessageSchema,
    error: WebWorkerRpcErrorMessageSchema,
});

export type WebWorkerRpcMessage = SchemaType<typeof webWorkerRpcMessageSchema>;
