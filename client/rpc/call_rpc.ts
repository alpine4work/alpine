import {getGlobalClientTracer} from "~/client/tracer/client_tracer";
import {InternalError, UnavailableError} from "~/shared/error/error";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error";
import {assert} from "~/shared/helpers/control/assert";
import {RpcHttpInputSchema, RpcHttpOutputSchema} from "~/shared/rpc/helpers/rpc_http_schema";
import {
    RpcDefinition,
    RpcDefinitionInputType,
    RpcDefinitionOutputType,
} from "~/shared/rpc/rpc_definition";
import {SchemaDeserializationError, SchemaSerializedValue} from "~/shared/schema/schema";
import {fetchWithTracerAndReturnSpan} from "~/shared/tracer/fetch_with_tracer";
import {TracerSpan} from "~/shared/tracer/tracer_span";

/**
 * Call an RPC function. Multiple RPC calls in a single synchronous function
 * call stack will be batched into a single execution.
 *
 * Can only call an RPC function from a web browser at the moment.
 */
export function callRpc<Definition extends RpcDefinition<any, any>>(
    definition: Definition,
    input: RpcDefinitionInputType<Definition>,
): Promise<RpcDefinitionOutputType<Definition>> {
    assert(typeof document !== "undefined", "Can only call RPCs in a web browser");

    return getGlobalClientTracer().withRootSpan(`RPC ${definition.name}`, async span => {
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
        scheduleMicrotask(() => {
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
        const input = {
            calls: callBatch.map(call => ({
                name: call.name,
                input: call.input,
            })),
        };

        const [firstCall, ...otherCalls] = callBatch;
        assert(firstCall);

        const {span, responsePromise} = fetchWithTracerAndReturnSpan(
            firstCall.span,
            new Request("/api/rpc", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify(RpcHttpInputSchema.serialize(input)),
            }),
        );

        // The first call is the parent of our HTTP execution. Link the other calls to
        // the HTTP execution span so we can see the causal relationship.
        for (const otherCall of otherCalls) {
            otherCall.span.link(span);
        }

        const response = await responsePromise.catch(error => {
            // Classify network errors as the `Unavailable` status code.
            throw new UnavailableError(error.message, {cause: error});
        });

        const output = await response
            .json()
            .then((output: any) => RpcHttpOutputSchema.deserialize(output))
            .catch(error => {
                // If we fail to parse the response body as JSON, classify as `Internal`
                // status code.
                //
                // Maybe an error is also thrown here for some network errors? If so we should
                // classify network errors as the `Unavailable` status code.
                throw new InternalError(error.message, {cause: error});
            });

        if (!output.ok) {
            throw output.error;
        }

        if (output.calls.length !== callBatch.length)
            throw new InternalError(
                `Expected ${callBatch.length} call outputs but received ${output.calls.length} call outputs`,
            );

        callBatch.forEach((call, index) => {
            // If anything throws while processing the output for a single call,
            // reject only that call's promise.
            const callOutput = output.calls[index]!;
            if (!callOutput.ok) {
                call.outputPromiseResolver.reject(callOutput.error);
            } else {
                call.outputPromiseResolver.resolve(callOutput.output);
            }
        });
    } catch (error) {
        for (const call of callBatch) {
            call.outputPromiseResolver.reject(error);
        }
    }
}
