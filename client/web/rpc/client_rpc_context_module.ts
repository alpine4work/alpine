import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver.js";
import {scheduleMacrotask} from "~/shared/helpers/async/schedule_macrotask.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {RpcCallId} from "~/shared/id/types/id_types.js";
import {deserializeRpcBatchResponse} from "~/shared/rpc/deserialize_rpc_batch_response.js";
import {
    RpcHttpBatchCallErrorOutputSchema,
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
 * authenticate the user. If many RPC calls are made in the same synchronous call
 * stack we will batch them together into one network request to avoid HTTP
 * roundtrip latency.
 */
export class ClientRpcContextModule extends RpcContextModuleBase<{tracer: TracerContextModule}> {
    constructor() {
        super();

        // We can only use this implementation of `RpcContextModuleBase` in a web browser
        // because the web browser has globally available cookies which authenticate our
        // user.
        //
        // In other environments we need to authenticate our user in some way.
        assert(typeof document !== "undefined");
    }

    public execute<Input, Output>(
        definition: RpcDefinition<Input, Output>,
        callId: RpcCallId,
        input: Input,
    ): Promise<Output> {
        return this._context.tracer.withSpan(`RPC ${definition.name}`, async (context, span) => {
            const outputPromiseResolver = createPromiseResolver<SchemaSerializedValue>();

            scheduleRpcCall({
                id: callId,
                name: definition.name,
                input: definition.inputSchema.serialize(input),
                outputPromiseResolver,
                span,
            });

            const output = await outputPromiseResolver.promise;

            try {
                return definition.outputSchema.deserialize(output);
            } catch (error) {
                // Reclassify deserialization errors as internal errors if we can't deserialize the
                // data coming from our RPC HTTP endpoint.
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
    readonly id: RpcCallId;
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

async function executeRpcs(callBatch: ReadonlyArray<RpcCall>): Promise<void> {
    assert(callBatch.length > 0);

    // If this function throws any error, we want to reject all calls in our batch with
    // that error.
    try {
        const [firstCall, ...otherCalls] = callBatch;
        assert(firstCall);

        await fetchWithTracer(
            firstCall.span,
            otherCalls.length === 0 ? `/api/rpc/${firstCall.name}` : "/api/rpc/_batch",
            {
                serviceName: "AppService",
                route: otherCalls.length === 0 ? "/api/rpc/:rpcName" : "/api/rpc/_batch",
                method: "POST",
                headers: {
                    "content-type": "application/json",
                },
                body:
                    otherCalls.length === 0
                        ? JSON.stringify(
                              RpcHttpCallInputSchema.serialize({
                                  id: firstCall.id,
                                  name: firstCall.name,
                                  input: firstCall.input,
                              }),
                          )
                        : JSON.stringify(
                              RpcHttpBatchCallInputSchema.serialize({
                                  calls: callBatch.map(call => ({
                                      id: call.id,
                                      name: call.name,
                                      input: call.input,
                                      tracerContext: call.span.getPropagationContext(),
                                  })),
                              }),
                          ),
            },
            async (response, span) => {
                // The first call is the parent of our HTTP execution. Link the other calls to the
                // HTTP execution span so we can see the causal relationship.
                for (const otherCall of otherCalls) {
                    otherCall.span.link(`Batch execution: ${span.getName()}`, span);
                }

                if (otherCalls.length === 0) {
                    const callOutput = await response
                        .json()
                        .then((output: any) => RpcHttpCallOutputSchema.deserialize(output))
                        .catch(error => {
                            // If we fail to parse the response body as JSON, classify as `Internal` status
                            // code.
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
                            // If we fail to parse the response body as JSON, classify as `Internal` status
                            // code.
                            //
                            // Maybe an error is also thrown here for some network errors? If so we should
                            // classify network errors as the `Unavailable` status code.
                            throw new InternalError(error.message, {cause: error});
                        });

                    throw output.error;
                } else {
                    await deserializeRpcBatchResponse(callBatch, response);
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
