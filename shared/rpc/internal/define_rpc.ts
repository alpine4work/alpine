import {Context} from "~/shared/context/context.js";
import {ErrorBase} from "~/shared/error/error.js";
import {isTransientError} from "~/shared/error/is_transient_error.js";
import {retryWithExponentialBackoff} from "~/shared/helpers/async/retry_with_exponential_backoff.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";
import {generateId} from "~/shared/id/id.js";
import {RpcCallId} from "~/shared/id/types/id_types.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {RpcDefinition} from "~/shared/rpc/rpc_definition.js";
import {ObjectSchemaConfigBase, ObjectSchemaConfigType, Schema} from "~/shared/schema/schema.js";

/**
 * Define the interface for an RPC.
 *
 * RPCs must all be defined in `~/shared/rpc`. That way our tooling can pick up all
 * defined RPCs and ensure there is a matching implementation on the server.
 *
 * We define RPCs in separate files so that code splitting works. Importing one RPC
 * only imports the dependencies for that RPC and nothing else.
 *
 * An RPC has an input object and an output object. If you already have an object
 * schema, we discourage you from reusing it. Instead nest your object schema in a
 * named property. This will allow you to add more inputs and outputs over time to
 * the RPC.
 *
 * ## Idempotency
 *
 * Every RPC must provide an `isIdempotent` flag. If true then if the RPC is called
 * twice with the same input then the output should be the same.
 *
 * If your RPC reads data, it's idempotent. If your RPC writes data, you need to
 * think carefully about whether it's idempotent or not.
 *
 * If true then if the RPC throws a transient error (decided by
 * `isTransientError()`) we'll retry the RPC call. Because if the RPC is idempotent
 * that means it's safe to retry!
 *
 * Ideally every single RPC should be idempotent! Transient network errors are an
 * inevitability. So we need to be ready to retry every RPC call we make. However,
 * we didn't have this policy in place until 2025-11-17. So to avoid breaking
 * existing code we allow some RPCs to be non-idempotent.
 *
 * If you set `isIdempotent: false`, please write a comment explaining why the RPC
 * isn't idempotent. Ideally you'd also describe how to make the RPC idempotent in
 * the future.
 *
 * ### Detailed definition of idempotency
 *
 * An RPC is idempotent if the RPC can be called multiple times:
 *
 * - With the exact same input
 * - In a short period of time (~1 minute)
 * - Without any other state changes happening between the calls
 *
 * ...and:
 *
 * - The result is the same
 * - Any side effects (e.g. sending a notification) happen only once
 * - Exception: `version` numbers may change between outputs (e.g.
 *   `updateLockVersion`)
 */
export function defineRpc<
    InputConfig extends ObjectSchemaConfigBase,
    OutputConfig extends ObjectSchemaConfigBase,
>({
    name,
    isIdempotent,
    input: inputConfig,
    output: outputConfig,
}: {
    name: string;
    isIdempotent: boolean;
    input: InputConfig;
    output: OutputConfig;
}): RpcDefinition<ObjectSchemaConfigType<InputConfig>, ObjectSchemaConfigType<OutputConfig>> {
    assert(isIdentifier(name), "RPC name should be a valid identifier");
    assert(name[0] === name[0]?.toLowerCase(), "RPC name should start with a lower case letter");

    const inputSchema = Schema.object(inputConfig);
    const outputSchema = Schema.object(outputConfig);

    const execute = (
        context: Context<{rpc: RpcContextModuleBase}>,
        input: ObjectSchemaConfigType<InputConfig>,
    ): Promise<ObjectSchemaConfigType<OutputConfig>> => {
        const callId = generateId<RpcCallId>();

        // Retry transient errors from idempotent RPCs.
        if (!isIdempotent) {
            return context.rpc.execute(definition, callId, input);
        } else {
            return retryWithExponentialBackoff(
                async retry => {
                    try {
                        const output = await context.rpc.execute(definition, callId, input);

                        return output;
                    } catch (error) {
                        if (
                            isTransientError(error) &&
                            (!(error instanceof ErrorBase) || !error.displayMessage)
                        ) {
                            throw retry(error);
                        } else {
                            throw error;
                        }
                    }
                },
                {maxAttemptCount: 5},
            );
        }
    };

    // Override the JavaScript function name with our RPC name. We need to use
    // `Object.defineProperty()` to override the JavaScript builtin name.
    Object.defineProperty(execute, "name", {value: name});

    const definition = Object.assign(execute, {
        inputSchema,
        outputSchema,
    });

    return definition;
}
