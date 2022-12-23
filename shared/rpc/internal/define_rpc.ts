import {assert} from "~/shared/helpers/control/assert";
import {isIdentifier} from "~/shared/helpers/string/is_identifier";
import {quote} from "~/shared/helpers/string/quote";
import {RpcDefinition} from "~/shared/rpc/rpc_definition";
import {ObjectSchemaConfigBase, ObjectSchemaConfigType, Schema} from "~/shared/schema/schema";

/**
 * Define the interface for an RPC.
 *
 * RPCs must all be defined in `~/shared/rpc`. That way our tooling can pick up
 * all defined RPCs and ensure there is a matching implementation on the
 * server.
 *
 * We define RPCs in separate files so that code splitting works. Importing one
 * RPC only imports the dependencies for that RPC and nothing else.
 *
 * An RPC has an input object and an output object. If you already have an
 * object schema, we discourage you from reusing it. Instead nest your object
 * schema in a named property. This will allow you to add more inputs and
 * outputs over time to the RPC.
 */
export function defineRpc<
    InputConfig extends ObjectSchemaConfigBase,
    OutputConfig extends ObjectSchemaConfigBase,
>({
    name,
    input: inputConfig,
    output: outputConfig,
}: {
    name: string;
    input: InputConfig;
    output: OutputConfig;
}): RpcDefinition<ObjectSchemaConfigType<InputConfig>, ObjectSchemaConfigType<OutputConfig>> {
    assert(isIdentifier(name), "RPC name should be a valid identifier");
    assert(name[0] === name[0]?.toLowerCase(), "RPC name should start with a lower case letter");

    assert(!definedRpcNames.has(name), quote`A definition for an RPC named ${name} already exists`);
    definedRpcNames.add(name);

    const inputSchema = Schema.object(inputConfig);
    const outputSchema = Schema.object(outputConfig);

    return {
        name,
        inputSchema,
        outputSchema,
    };
}

const definedRpcNames = new Set<string>();

/**
 * Get the names of all RPCs that have been defined.
 */
export function getAllDefinedRpcNames(): IterableIterator<string> {
    return definedRpcNames.values();
}
