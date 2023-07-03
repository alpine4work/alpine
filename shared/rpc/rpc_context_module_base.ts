import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {RpcDefinition} from "~/shared/rpc/rpc_definition.js";

/**
 * Context module for executing an RPC from anywhere.
 *
 * In a web browser this will be a cross-network `fetch()` call and
 * authenticated with cookies. In our app worker this will be a local function
 * call using authentication from the context.
 */
export abstract class RpcContextModuleBase<
    Modules extends {} = {},
> extends ContextModuleBase<Modules> {
    public abstract execute<Input, Output>(
        definition: RpcDefinition<Input, Output>,
        input: Input,
    ): Promise<Output>;

    /**
     * Clones the RPC module so it can be used in a different context. Returns an
     * unbound context module even if the source context module is bound.
     */
    public abstract clone(): RpcContextModuleBase<Modules>;
}
