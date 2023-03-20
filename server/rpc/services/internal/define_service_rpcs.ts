import {
    ServiceRpcDefinitions,
    ServiceRpcDefinitionsConfigBase,
} from "~/server/rpc/services/service_rpc_definitions";
import {Context} from "~/shared/context/context";
import {UnimplementedError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values";
import {isIdentifier} from "~/shared/helpers/string/is_identifier";
import {quote} from "~/shared/helpers/string/quote";
import {ObjectSchemaConfigType, Schema} from "~/shared/schema/schema";
import {TracerServiceName} from "~/shared/tracer/tracer_root";

const definedServiceNames = new Set<string>();

/**
 * Define the interface for all RPCs that are implemented by a service. Service RPCs,
 * unlike regular RPCs, may only be called on the server.
 */
export function defineServiceRpcs<Config extends ServiceRpcDefinitionsConfigBase>(
    name: TracerServiceName & `${string}Service`,
    config: Config,
): ServiceRpcDefinitions<Config> {
    assert(isIdentifier(name), "Service name should be a valid identifier");
    assert(
        name[0] === name[0]?.toUpperCase(),
        "Service name should start with an upper case letter",
    );
    assert(name.endsWith("Service"), 'Service name should end with the string "Service"');

    assert(
        !definedServiceNames.has(name),
        quote`A definition for the service ${name} already exists`,
    );
    definedServiceNames.add(name);

    return mapObjectValues(config, ({input: inputConfig, output: outputConfig}, name) => {
        assert(isIdentifier(name), "RPC name should be a valid identifier");
        assert(
            name[0] === name[0]?.toLowerCase(),
            "RPC name should start with a lower case letter",
        );

        const inputSchema = Schema.object(inputConfig);
        const outputSchema = Schema.object(outputConfig);

        const execute = async (
            context: Context<{}>,
            input: ObjectSchemaConfigType<typeof inputConfig>,
        ): Promise<ObjectSchemaConfigType<typeof outputConfig>> => {
            throw new UnimplementedError("TODO");
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
    }) as ServiceRpcDefinitions<Config>;
}
