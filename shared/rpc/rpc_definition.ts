import {Context} from "~/shared/context/context.js";
import {RpcContextModuleBase} from "~/shared/rpc/rpc_context_module_base.js";
import {ObjectSchema} from "~/shared/schema/schema.open_source.js";

export type RpcDefinitionInputType<Definition extends RpcDefinition<any, any>> =
    Definition extends RpcDefinition<infer Input, any> ? Input : never;

export type RpcDefinitionOutputType<Definition extends RpcDefinition<any, any>> =
    Definition extends RpcDefinition<any, infer Output> ? Output : never;

/**
 * A function that is implemented on the server and can be called from the client
 * using an HTTP interface. Also known as a remote procedure which is executed with
 * a [remote procedure call][1].
 *
 * You define RPC functions in `~/shared/rpc` with `defineRpc()` so the definition
 * can be accessed anywhere in our codebase.
 *
 * [1]: https://en.wikipedia.org/wiki/Remote_procedure_call
 */
export interface RpcDefinition<Input, Output> {
    (context: Context<{rpc: RpcContextModuleBase}>, input: Input): Promise<Output>;

    /**
     * The name used to identify the function on client and server.
     *
     * Must be an identifier that starts with a lowercase letter.
     *
     * Functions also have a `name` property so we do override the JavaScript function
     * name with the RPC function name.
     */
    readonly name: string;

    /**
     * Schema for input data to this function. The function input is always an object.
     * This makes it easy to add new inputs to the function over time.
     */
    readonly inputSchema: ObjectSchema<Input>;

    /**
     * Schema for output data returned by this function. The function output is always
     * an object. This makes it easy to add new outputs to the function over time.
     */
    readonly outputSchema: ObjectSchema<Output>;
}
