import {
    WebWorkerRpcMessage,
    webWorkerRpcMessageSchema,
} from "~/client/web/helpers/workers/web_worker_rpc_message.js";
import {WebWorkerRpcMethodDefinitions} from "~/client/web/helpers/workers/web_worker_rpc_method.js";
import {UnknownError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {ObjectSchema, SchemaSerializedValue, SchemaType} from "~/shared/schema/schema.js";

/**
 * Typed handler map inferred from a method definitions object. Each key matches a
 * method name; the handler receives deserialized input and returns deserialized
 * output.
 */
export type WebWorkerRpcHandlers<Def extends WebWorkerRpcMethodDefinitions> = {
    readonly [K in keyof Def]: (
        input: SchemaType<Def[K]["inputSchema"]>,
    ) => Promise<SchemaType<Def[K]["outputSchema"]>>;
};

/**
 * Typed RPC for web worker communication. Supports asymmetric method sets:
 * `CallDef` lists methods this side can invoke on the remote, `HandleDef` lists
 * methods the remote can invoke on this side.
 *
 * - Use {@link call} to invoke a method on the remote side.
 * - Use {@link handleMessage} to process incoming messages.
 *
 * The boundaries are `unknown` — the class handles all
 * serialization/deserialization of messages via schemas. Pass a `send` callback
 * (e.g. `postMessage`) and feed incoming data (e.g. from `onmessage`) into
 * `handleMessage`.
 */
export class WebWorkerRpc<
    CallDef extends WebWorkerRpcMethodDefinitions,
    HandleDef extends WebWorkerRpcMethodDefinitions,
> {
    private readonly handlers: Map<string, (input: any) => Promise<any>>;
    private readonly callMethodSchemas: Map<
        string,
        {inputSchema: ObjectSchema<any>; outputSchema: ObjectSchema<any>}
    >;
    private readonly handleMethodSchemas: Map<
        string,
        {inputSchema: ObjectSchema<any>; outputSchema: ObjectSchema<any>}
    >;
    private readonly send: (message: unknown) => void;
    private readonly pending = new Map<
        number,
        {
            resolve: (value: any) => void;
            reject: (error: Error) => void;
            outputSchema: ObjectSchema<any>;
        }
    >();
    private nextCallId = 0;

    constructor(config: {
        callMethods: CallDef;
        handleMethods: HandleDef;
        handlers: WebWorkerRpcHandlers<HandleDef>;
        send: (message: unknown) => void;
    }) {
        this.send = config.send;

        this.callMethodSchemas = new Map();
        for (const name of Object.keys(config.callMethods)) {
            const method = config.callMethods[name]!;
            this.callMethodSchemas.set(name, {
                inputSchema: method.inputSchema,
                outputSchema: method.outputSchema,
            });
        }

        this.handlers = new Map();
        this.handleMethodSchemas = new Map();
        for (const name of Object.keys(config.handleMethods)) {
            const method = config.handleMethods[name]!;
            this.handleMethodSchemas.set(name, {
                inputSchema: method.inputSchema,
                outputSchema: method.outputSchema,
            });
            this.handlers.set(
                name,
                (config.handlers as Record<string, (input: any) => Promise<any>>)[name]!,
            );
        }
    }

    /**
     * Call a method on the remote side. Serializes the input and the outgoing message,
     * sends it via the `send` callback, and returns a promise that resolves when the
     * remote side responds.
     */
    call<K extends string & keyof CallDef>(
        method: K,
        input: SchemaType<CallDef[K]["inputSchema"]>,
    ): Promise<SchemaType<CallDef[K]["outputSchema"]>> {
        const schemas = this.callMethodSchemas.get(method);
        assert(schemas !== undefined, `Unknown call method: ${method}`);

        const callId = this.nextCallId++;
        const serializedInput = schemas.inputSchema.serialize(input);

        return new Promise((resolve, reject) => {
            this.pending.set(callId, {
                resolve,
                reject,
                outputSchema: schemas.outputSchema,
            });
            this.sendMessage({type: "request", callId, method, input: serializedInput});
        });
    }

    /**
     * Process an incoming message. Deserializes the raw value using the message
     * schema, then dispatches by type:
     *
     * - `"request"` — deserialize input, call local handler, send response (or error
     *   if handler throws).
     * - `"response"` — deserialize output, resolve pending promise.
     * - `"error"` — reject pending promise.
     */
    handleMessage(raw: unknown): void {
        const message = webWorkerRpcMessageSchema.deserialize(raw as SchemaSerializedValue);

        switch (message.type) {
            case "request":
                this.handleRequest(message);
                break;
            case "response":
                this.handleResponse(message);
                break;
            case "error":
                this.handleError(message);
                break;
        }
    }

    private sendMessage(message: WebWorkerRpcMessage): void {
        this.send(webWorkerRpcMessageSchema.serialize(message));
    }

    private handleRequest(message: {
        callId: number;
        method: string;
        input: SchemaSerializedValue;
    }): void {
        const schemas = this.handleMethodSchemas.get(message.method);
        const handler = this.handlers.get(message.method);

        if (!schemas || !handler) {
            this.sendMessage({
                type: "error",
                callId: message.callId,
                message: `Unknown method: ${message.method}`,
            });
            return;
        }

        const input = schemas.inputSchema.deserialize(message.input);

        handler(input).then(
            output => {
                this.sendMessage({
                    type: "response",
                    callId: message.callId,
                    output: schemas.outputSchema.serialize(output),
                });
            },
            error => {
                this.sendMessage({
                    type: "error",
                    callId: message.callId,
                    message: error instanceof Error ? error.message : String(error),
                });
            },
        );
    }

    private handleResponse(message: {callId: number; output: SchemaSerializedValue}): void {
        const entry = this.pending.get(message.callId);
        if (!entry) return;
        this.pending.delete(message.callId);
        const output = entry.outputSchema.deserialize(message.output);
        entry.resolve(output);
    }

    private handleError(message: {callId: number; message: string}): void {
        const entry = this.pending.get(message.callId);
        if (!entry) return;
        this.pending.delete(message.callId);
        entry.reject(new UnknownError(message.message));
    }
}
