import {RpcDefinition} from "~/shared/rpc/rpc_definition";

/**
 * Context module for executing an RPC from anywhere.
 *
 * In a web browser this will be a cross-network `fetch()` call and
 * authenticated with cookies. In our app worker this will be a local function
 * call using authentication from the context.
 */
export abstract class RpcContextModuleBase {
    public abstract execute<Input, Output>(
        definition: RpcDefinition<Input, Output>,
        input: Input,
    ): Promise<Output>;
}
