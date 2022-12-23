import {ObjectSchema} from "~/shared/schema/schema";

export type RpcDefinitionInputType<Definition extends RpcDefinition<any, any>> =
    Definition extends RpcDefinition<infer Input, any> ? Input : never;

export type RpcDefinitionOutputType<Definition extends RpcDefinition<any, any>> =
    Definition extends RpcDefinition<any, infer Output> ? Output : never;

/**
 * A function that is implemented on the server and can be called from the
 * client using an HTTP interface. Also known as a remote procedure which is
 * executed with a [remote procedure call][1].
 *
 * You define RPC functions in `~/shared/rpc` with `defineRpc()` so the
 * definition can be accessed anywhere in our codebase.
 *
 * You call RPC functions with `callRpc()` from `~/client/rpc`. Currently you
 * may only call RPC functions on the client.
 *
 * [1]: https://en.wikipedia.org/wiki/Remote_procedure_call
 */
export interface RpcDefinition<Input, Output> {
    /**
     * The name used to identify the function on client and server.
     *
     * Must be an identifier that starts with a lowercase letter.
     */
    readonly name: string;

    /**
     * Schema for input data to this function. The function input is always an
     * object. This makes it easy to add new inputs to the function over time.
     */
    readonly inputSchema: ObjectSchema<Input>;

    /**
     * Schema for output data returned by this function. The function output is
     * always an object. This makes it easy to add new outputs to the function
     * over time.
     */
    readonly outputSchema: ObjectSchema<Output>;
}
