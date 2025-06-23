import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {scheduleMacrotask} from "~/shared/helpers/async/schedule_macrotask.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    RpcHttpBatchCallErrorOutputSchema,
    RpcHttpBatchCallEventOutputSchema,
    RpcHttpBatchCallInputSchema,
    RpcHttpCallInputSchema,
    RpcHttpCallOutputSchema,
} from "~/shared/rpc/helpers/rpc_http_schema.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {RpcDefinition} from "~/shared/rpc/rpc_definition.js";
import {SchemaDeserializationError, SchemaSerializedValue} from "~/shared/schema/schema.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";
import {TracerSpan} from "~/shared/tracer/tracer_span.js";

/**
 * Executes an RPC in the web browser. Uses cookies stored in the browser to
 * authenticate the user. If many RPC calls are made in the same synchronous
 * call stack we will batch them together into one network request to avoid
 * HTTP roundtrip latency.
 */
export class ClientRpcContextModule extends RpcContextModuleBase<{tracer: TracerContextModule}> {
    constructor() {
        super();

        // We can only use this implementation of `RpcContextModuleBase` in a web
        // browser because the web browser has globally available cookies which
        // authenticate our user.
        //
        // In other environments we need to authenticate our user in some way.
        assert(typeof document !== "undefined");
    }

    public execute<Input, Output>(
        definition: RpcDefinition<Input, Output>,
        input: Input,
    ): Promise<Output> {
        return this._context.tracer.withSpan(`RPC ${definition.name}`, async (context, span) => {
            const outputPromiseResolver = createPromiseResolver<SchemaSerializedValue>();

            scheduleRpcCall({
                name: definition.name,
                input: definition.inputSchema.serialize(input),
                outputPromiseResolver,
                span,
            });

            const output = await outputPromiseResolver.promise;

            try {
                return definition.outputSchema.deserialize(output);
            } catch (error) {
                // Reclassify deserialization errors as internal errors if we can't deserialize
                // the data coming from our RPC HTTP endpoint.
                if (error instanceof SchemaDeserializationError) {
                    throw new InternalError(error.message, {cause: error});
                }
                throw error;
            }
        });
    }

    public fork() {
        return new ClientRpcContextModule();
    }
}

type RpcCall = {
    readonly name: string;
    readonly input: SchemaSerializedValue;
    readonly outputPromiseResolver: PromiseResolver<SchemaSerializedValue>;
    readonly span: TracerSpan;
};

let scheduledRpcCallBatch: Array<RpcCall> | null = null;

function scheduleRpcCall(call: RpcCall): void {
    if (scheduledRpcCallBatch === null) {
        scheduledRpcCallBatch = [];

        // Wait to batch RPC calls in a macrotask. This way we can batch any calls
        // scheduled after microtasks.
        scheduleMacrotask(() => {
            assert(scheduledRpcCallBatch !== null);
            const callBatch = scheduledRpcCallBatch;
            scheduledRpcCallBatch = null;
            executeRpcs(callBatch).catch(scheduleUncaughtError);
        });
    }

    scheduledRpcCallBatch.push(call);
}

async function executeRpcs(callBatch: Array<RpcCall>): Promise<void> {
    assert(callBatch.length > 0);

    // If this function throws any error, we want to reject all calls in our
    // batch with that error.
    try {
        const [firstCall, ...otherCalls] = callBatch;
        assert(firstCall);

        const spaceIdRegExp = /^\/s\/([^/]+)(?:\/|$)/;
        const spaceIdFromUrl =
            typeof window !== "undefined"
                ? new URL(window.location.href).pathname.match(spaceIdRegExp)?.[1]
                : undefined;

        await fetchWithTracer(
            firstCall.span,
            otherCalls.length === 0 ? `/api/rpc/${firstCall.name}` : "/api/rpc/_batch",
            {
                serviceName: "AppService",
                route: otherCalls.length === 0 ? "/api/rpc/:rpcName" : "/api/rpc/_batch",
                method: "POST",
                headers: {
                    "content-type": "application/json",
                    // As an optimization, include the space ID from our URL in RPC calls which
                    // we'll use to authorize whether the current account has access to the
                    // requested space.
                    //
                    // This does not provide any security guarantees! This is purely a performance
                    // optimization to authorize the session and space access at once.
                    ...(spaceIdFromUrl ? {"cyberworlds-space-id-hint": spaceIdFromUrl} : {}),
                },
                body:
                    otherCalls.length === 0
                        ? JSON.stringify(
                              RpcHttpCallInputSchema.serialize({
                                  name: firstCall.name,
                                  input: firstCall.input,
                              }),
                          )
                        : JSON.stringify(
                              RpcHttpBatchCallInputSchema.serialize({
                                  calls: callBatch.map(call => ({
                                      name: call.name,
                                      input: call.input,
                                  })),
                              }),
                          ),
            },
            async (response, span) => {
                // The first call is the parent of our HTTP execution. Link the other calls to
                // the HTTP execution span so we can see the causal relationship.
                for (const otherCall of otherCalls) {
                    otherCall.span.link(`Batch execution: ${span.getName()}`, span);
                }

                if (otherCalls.length === 0) {
                    const callOutput = await response
                        .json()
                        .then((output: any) => RpcHttpCallOutputSchema.deserialize(output))
                        .catch(error => {
                            // If we fail to parse the response body as JSON, classify as `Internal`
                            // status code.
                            //
                            // Maybe an error is also thrown here for some network errors? If so we should
                            // classify network errors as the `Unavailable` status code.
                            throw new InternalError(error.message, {cause: error});
                        });

                    if (!callOutput.ok) {
                        firstCall.outputPromiseResolver.reject(callOutput.error);
                    } else {
                        firstCall.outputPromiseResolver.resolve(callOutput.output);
                    }
                } else if (!response.ok) {
                    const output = await response
                        .json()
                        .then((output: any) =>
                            RpcHttpBatchCallErrorOutputSchema.deserialize(output),
                        )
                        .catch(error => {
                            // If we fail to parse the response body as JSON, classify as `Internal`
                            // status code.
                            //
                            // Maybe an error is also thrown here for some network errors? If so we should
                            // classify network errors as the `Unavailable` status code.
                            throw new InternalError(error.message, {cause: error});
                        });

                    throw output.error;
                } else {
                    const decoder = new TextDecoder();
                    const reader = assertExists(response.body).getReader();

                    async function* read(): AsyncIterableIterator<string> {
                        let unfinishedString = "";

                        while (true) {
                            const result = await reader.read();

                            if (result.value) {
                                const chunkString = decoder.decode(result.value, {
                                    stream: !result.done,
                                });

                                // If there's a newline in the output that means the content preceding the
                                // newline has at least one valid event maybe more.
                                let newLineIndex = chunkString.lastIndexOf("\n");

                                if (newLineIndex !== -1) {
                                    newLineIndex += unfinishedString.length;
                                }

                                unfinishedString =
                                    unfinishedString.length === 0
                                        ? chunkString
                                        : unfinishedString + chunkString;

                                if (newLineIndex !== -1) {
                                    const finishedString = unfinishedString.slice(0, newLineIndex);
                                    unfinishedString = unfinishedString.slice(newLineIndex + 1);

                                    yield* finishedString.split("\n");
                                }
                            }

                            if (result.done) {
                                break;
                            }
                        }

                        // Once we're done reading, we assume the last string is also valid JSON.
                        // Unless the string is empty. Then we assume it's a trailing newline.
                        if (unfinishedString.length !== 0) {
                            yield unfinishedString;
                        }
                    }

                    for await (const eventString of read()) {
                        const event = RpcHttpBatchCallEventOutputSchema.deserialize(
                            JSON.parse(eventString),
                        );

                        const call = callBatch[event.index];
                        const callOutput = event.call;

                        if (!call) {
                            throw new InternalError(
                                "Batch request included output for an unknown call",
                            );
                        }

                        // If anything throws while processing the output for a single call,
                        // reject only that call's promise.
                        if (!callOutput.ok) {
                            call.outputPromiseResolver.reject(callOutput.error);
                        } else {
                            call.outputPromiseResolver.resolve(callOutput.output);
                        }
                    }

                    for (const call of callBatch) {
                        if (!call.outputPromiseResolver.isSettled()) {
                            call.outputPromiseResolver.reject(
                                new InternalError("Batch request didn’t include output for call"),
                            );
                        }
                    }
                }
            },
        );
    } catch (error) {
        let hasRejectedCall = false;

        for (const call of callBatch) {
            if (!call.outputPromiseResolver.isSettled()) {
                hasRejectedCall = true;
                call.outputPromiseResolver.reject(error);
            }
        }

        if (!hasRejectedCall) {
            scheduleUncaughtError(error);
        }
    }
}
