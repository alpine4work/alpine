import {ActorServiceName} from "~/server/helpers/actor_context_module.js";
import {RpcServerActionContext} from "~/server/rpc/rpc_server_action_context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError, PermissionDeniedError} from "~/shared/error/error.js";
import {MonotonicClock} from "~/shared/helpers/clock/monotonic_clock.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {RpcCallId} from "~/shared/id/types/id_types.js";
import {
    RpcDefinition,
    RpcDefinitionInputType,
    RpcDefinitionOutputType,
} from "~/shared/rpc/rpc_definition.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";
import {TracerSpan, TracerSpanPropagationContext} from "~/shared/tracer/tracer_span.js";

export type RpcExecuteOptions = {
    replaceTracerPropagationContext?: TracerSpanPropagationContext;
};

export type RpcImplementation<Input, Output> = {
    execute(
        context: RpcServerActionContext,
        callId: RpcCallId,
        input: SchemaSerializedValue,
        options?: RpcExecuteOptions,
    ): Promise<SchemaSerializedValue>;
    executeWithoutSerialization(
        context: RpcServerActionContext,
        callId: RpcCallId,
        input: Input,
        options?: RpcExecuteOptions,
    ): Promise<Output>;
};

type RpcImplementationOptions<Input, Output> = {
    visibility: "Public" | ReadonlyArray<ActorServiceName>;
    execute: (
        context: RpcServerActionContext,
        input: Input,
        options: {callId: RpcCallId},
    ) => Promise<Output>;
};

/**
 * Implements a set of RPCs on the server. RPCs are defined in `~/shared/rpc`
 * and implemented in `~/server/rpc`. This way the client has access to the RPC
 * definitions but only the server can actually implement them.
 *
 * You pass a `visibility` array to decide which services may call this RPC. We
 * get the name from Bazel `visibility`. In the future we may actually enforce
 * who can call an RPC with Bazel visibility for better static analysis, code
 * colocation, and bundle splitting.
 */
export function implementRpcs<Definitions extends {[key: string]: RpcDefinition<any, any>}>(
    definitions: Definitions,
    implementations: {
        [Key in keyof Definitions]: RpcImplementationOptions<
            RpcDefinitionInputType<Definitions[Key]>,
            RpcDefinitionOutputType<Definitions[Key]>
        >;
    },
): {
    [Key in keyof Definitions]: RpcImplementation<
        RpcDefinitionInputType<Definitions[Key]>,
        RpcDefinitionOutputType<Definitions[Key]>
    >;
} {
    for (const definitionKey of Object.keys(definitions)) {
        if (!implementations[definitionKey]) {
            throw new InternalError(
                quote`Missing RPC implementation for RPC definition ${definitionKey}`,
            );
        }
    }

    for (const implementationKey of Object.keys(implementations)) {
        if (!definitions[implementationKey]) {
            throw new InternalError(
                quote`Missing RPC definition for RPC implementation ${implementationKey}`,
            );
        }
    }

    assert(
        isDeepEqual(new Set(Object.keys(definitions)), new Set(Object.keys(implementations))),
        "Every RPC definition must have an implementation",
    );

    return mapObjectValues(
        implementations,
        <Input, Output>(
            {
                visibility: visibilityArray,
                execute: implementation,
            }: RpcImplementationOptions<Input, Output>,
            key: keyof Definitions & string,
        ): RpcImplementation<Input, Output> => {
            const definition = definitions[key]!;
            assert(
                definition.name === key,
                quote`RPC definition name and key mismatch (name: ${definition.name}, key: ${key})`,
            );

            const visibility =
                visibilityArray === "Public"
                    ? "Public"
                    : new Set<ActorServiceName>(visibilityArray);

            const executeWithoutSerialization = (
                context: RpcServerActionContext,
                callId: RpcCallId,
                input: Input,
                options?: RpcExecuteOptions,
            ): Promise<Output> => {
                const tracerBase = context.tracer.getTracer();
                const tracer = tracerBase.getRoot();

                // `tracerBase instanceof TracerSpan` doesn't work because in `AppService`, due
                // to our hot reloading setup, `tracerBase` may come from a different
                // JavaScript runtime.
                const parentSpan = hasOwnProperty(tracerBase, "traceId")
                    ? (tracerBase as TracerSpan)
                    : null;

                // Create a span manually. If `replaceTracerPropagationContext` is set then we
                // want to use the `traceId`/`parentId` of the span in `context` but we want to
                // use the propagated data from `replaceTracerPropagationContext`.
                //
                // This is important for when `WorkerRpcContextModule` calls
                // `/api/rpc/_batchByActor` because we want to use the right
                // `context.accountId` for each call. We don't want to use the
                // `context.accountId` of the first call which happens to be the span parent.
                const {span, finishSpan} = TracerSpan._start(
                    tracer,
                    // Inherit the parent span's clock if available.
                    parentSpan?.clock ?? new MonotonicClock(tracer.getNonMonotonicClock()),
                    `Handle: RPC ${definition.name}`,
                    parentSpan === null
                        ? (options?.replaceTracerPropagationContext ?? null)
                        : {
                              traceId: parentSpan.traceId,
                              parentId: parentSpan._getSpanId(),
                              propagatedEventData: options?.replaceTracerPropagationContext
                                  ? undefined
                                  : parentSpan._getPropagatedEventData(),
                              propagatedEventFlatData: options?.replaceTracerPropagationContext
                                  ? options?.replaceTracerPropagationContext.data
                                  : parentSpan._getPropagatedEventFlatData(),
                          },
                );

                return context.with({tracer: new TracerContextModule(span)}, async context => {
                    try {
                        span.addPropagatedDataForChildrenOnly({
                            context: {
                                handler: `RPC ${definition.name}`,
                            },
                        });

                        // RPCs may only be executed from specific services. For instance, you can only
                        // call `updateDocumentContent()` from `DocumentCollaborationService`. If
                        // anyone else was able to call `updateDocumentContent()` then it would break
                        // `DocumentCollaborationService`'s centralized knowledge of the current
                        // document version.
                        const isVisible =
                            visibility === "Public" ||
                            visibility.has(context.actor.serviceName) ||
                            // In a test environment, tests can execute any RPC.
                            (process.env.NODE_ENV === "test" &&
                                context.actor.serviceName === "Test");

                        if (!isVisible) {
                            throw new PermissionDeniedError(
                                quote`Can\u2019t execute RPC ${definition.name} from ${context.actor.serviceName}`,
                            );
                        }

                        const output = (await implementation(context, input, {callId})) as Output;
                        finishSpan();
                        return output;
                    } catch (error) {
                        span.addException(error);
                        finishSpan();
                        throw error;
                    }
                });
            };

            const execute = async (
                context: RpcServerActionContext,
                callId: RpcCallId,
                serializedInput: SchemaSerializedValue,
                options?: RpcExecuteOptions,
            ): Promise<SchemaSerializedValue> => {
                const input = definition.inputSchema.deserialize(serializedInput);
                const output = await executeWithoutSerialization(context, callId, input, options);
                return definition.outputSchema.serialize(output);
            };

            return {
                execute,
                executeWithoutSerialization: (context, callId, input, options) => {
                    // Make sure the input is well formed beyond complying with the TypeScript
                    // types without doing a full serialization/deserialization.
                    definition.inputSchema.validate?.(input);

                    return executeWithoutSerialization(context, callId, input, options);
                },
            };
        },
    );
}
