import {Context} from "~/shared/context/context.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isIdentifier} from "~/shared/helpers/string/is_identifier.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {RpcDefinition} from "~/shared/rpc/rpc_definition.js";
import {ObjectSchemaConfigBase, ObjectSchemaConfigType, Schema} from "~/shared/schema/schema.js";

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

    const execute = async (
        context: Context<{rpc: RpcContextModuleBase}>,
        input: ObjectSchemaConfigType<InputConfig>,
    ): Promise<ObjectSchemaConfigType<OutputConfig>> => {
        return context.rpc.execute(definition, input);
    };

    // Override the JavaScript function name with our RPC name. We
    // need to use `Object.defineProperty()` to override the JavaScript
    // builtin name.
    Object.defineProperty(execute, "name", {value: name});

    const definition = Object.assign(execute, {
        inputSchema,
        outputSchema,
    });

    return definition;
}

const definedRpcNames = new Set<string>();

/**
 * Get the names of all RPCs that have been defined.
 */
export function getAllDefinedRpcNames(): IterableIterator<string> {
    return definedRpcNames.values();
}
