import {ActorServiceName} from "~/server/helpers/actor_context_module.js";
import {RpcServerActionContext} from "~/server/rpc/rpc_server_action_context.js";
import {InternalError, PermissionDeniedError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {
    RpcDefinition,
    RpcDefinitionInputType,
    RpcDefinitionOutputType,
} from "~/shared/rpc/rpc_definition.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

export type RpcImplementation<Input, Output> = {
    execute(
        context: RpcServerActionContext,
        input: SchemaSerializedValue,
    ): Promise<SchemaSerializedValue>;
    executeWithoutSerialization(context: RpcServerActionContext, input: Input): Promise<Output>;
};

type RpcImplementationOptions<Input, Output> = {
    visibility: "Public" | ReadonlyArray<ActorServiceName>;
    execute: (context: RpcServerActionContext, input: Input) => Promise<Output>;
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
                input: Input,
            ): Promise<Output> => {
                return context.tracer.withSpan(
                    `Handle: RPC ${definition.name}`,
                    async (context, span) => {
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
                                quote`Can’t execute RPC ${definition.name} from ${context.actor.serviceName}`,
                            );
                        }

                        const output = (await implementation(context, input)) as Output;
                        return output;
                    },
                );
            };

            const execute = async (
                context: RpcServerActionContext,
                serializedInput: SchemaSerializedValue,
            ): Promise<SchemaSerializedValue> => {
                const input = definition.inputSchema.deserialize(serializedInput);
                const output = await executeWithoutSerialization(context, input);
                return definition.outputSchema.serialize(output);
            };

            return {
                execute,
                executeWithoutSerialization: (context, input) => {
                    // Make sure the input is well formed beyond complying with the TypeScript
                    // types without doing a full serialization/deserialization.
                    definition.inputSchema.validate?.(input);

                    return executeWithoutSerialization(context, input);
                },
            };
        },
    );
}
