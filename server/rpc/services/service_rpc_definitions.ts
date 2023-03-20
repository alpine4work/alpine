import {UnauthenticatedRequestContext} from "~/server/dynamo/context/request_context";
import {Context} from "~/shared/context/context";
import {RpcDefinition} from "~/shared/rpc/rpc_definition";
import {ObjectSchema, ObjectSchemaConfigBase, ObjectSchemaConfigType} from "~/shared/schema/schema";

export type ServiceRpcDefinitionsConfigBase = {
    [rpcName: string]: {input: ObjectSchemaConfigBase; output: ObjectSchemaConfigBase};
};

export type ServiceRpcDefinitions<Config extends ServiceRpcDefinitionsConfigBase> = {
    [Key in keyof Config]: ServiceRpcDefinition<
        ObjectSchemaConfigType<Config[Key]["input"]>,
        ObjectSchemaConfigType<Config[Key]["output"]>
    >;
};

export interface ServiceRpcDefinition<Input, Output> {
    (context: Context<{}>, input: Input): Promise<Output>;
    readonly name: string;
    readonly inputSchema: ObjectSchema<Input>;
    readonly outputSchema: ObjectSchema<Output>;
}

export type ServiceRpcImplementation = {
    handle(
        context: UnauthenticatedRequestContext,
        request: Request,
    ): {handled: true; responsePromise: Promise<Response>} | {handled: false};
};
