import {ObjectSchema} from "~/shared/schema/schema";

/**
 * A function which executes a [remote procedure call][1]. RPCs are functions
 * implemented on the server that the client can execute through an HTTP
 * network interface.
 *
 * If you call an RPC on the client, it will hit an HTTP endpoint. If you call
 * an RPC on the server it will lookup the RPC implementation and call that.
 *
 * [1]: https://en.wikipedia.org/wiki/Remote_procedure_call
 */
// TODO(calebmer): I don't like having to abbreviate the name "RPC". Consider
// renaming to "Procedure" or "RemoteProcedure".
export interface Rpc<Input, Output> {
    (input: Input): Promise<Output>;
    // We call this `rpcName` to disambiguate from the function `name`.
    readonly rpcName: string;
    readonly inputSchema: ObjectSchema<Input>;
    readonly outputSchema: ObjectSchema<Output>;
}
