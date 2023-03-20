import {UnauthenticatedRequestContext} from "~/server/dynamo/context/request_context";
import {
    ServiceRpcDefinitions,
    ServiceRpcDefinitionsConfigBase,
    ServiceRpcImplementation,
} from "~/server/rpc/services/service_rpc_definitions";
import {ObjectSchemaConfigType} from "~/shared/schema/schema";

export function implementServiceRpcs<Config extends ServiceRpcDefinitionsConfigBase>(
    definitions: ServiceRpcDefinitions<Config>,
    implementations: {
        [Key in keyof Config]: (
            context: UnauthenticatedRequestContext,
            input: ObjectSchemaConfigType<Config[Key]["input"]>,
        ) => Promise<ObjectSchemaConfigType<Config[Key]["output"]>>;
    },
): ServiceRpcImplementation {
    return null as any;
}
