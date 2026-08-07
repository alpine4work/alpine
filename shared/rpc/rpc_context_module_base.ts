import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {RpcCallId} from "~/shared/id/types/id_types.open_source.js";
import {RpcDefinition} from "~/shared/rpc/rpc_definition.js";

/**
 * Context module for executing an RPC from anywhere.
 *
 * In a web browser this will be a cross-network `fetch()` call and authenticated
 * with cookies. In our app worker this will be a local function call using
 * authentication from the context.
 */
export abstract class RpcContextModuleBase<Modules extends {} = {}>
    extends ContextModuleBase<Modules>
    implements ForkableContextModuleBase
{
    public abstract execute<Input, Output>(
        definition: RpcDefinition<Input, Output>,
        callId: RpcCallId,
        input: Input,
    ): Promise<Output>;

    public abstract fork(): RpcContextModuleBase;
}
