import {Context} from "~/shared/context/context";
import {TracerContextModule} from "~/shared/context/tracer_context_module";
import {InternalError, UnavailableError} from "~/shared/error/error";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise_resolver";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error";
import {assert} from "~/shared/helpers/control/assert";
import {RpcHttpInputSchema, RpcHttpOutputSchema} from "~/shared/rpc/helpers/rpc_http_schema";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base";
import {RpcDefinition} from "~/shared/rpc/rpc_definition";
import {SchemaDeserializationError, SchemaSerializedValue} from "~/shared/schema/schema";
import {fetchWithTracerAndReturnSpan} from "~/shared/tracer/fetch_with_tracer";
import {TracerSpan} from "~/shared/tracer/tracer";

/**
 * Executes an RPC in the web browser. Uses cookies stored in the browser to
 * authenticate the user. If many RPC calls are made in the same synchronous
 * call stack we will batch them together into one network request to avoid
 * HTTP roundtrip latency.
 */
export class ClientRpcContextModule extends RpcContextModuleBase {
    constructor(private readonly context: Context<{tracer: TracerContextModule<{}>}>) {
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
        return this.context.tracer().withSpan(`RPC ${definition.name}`, async (context, span) => {
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
