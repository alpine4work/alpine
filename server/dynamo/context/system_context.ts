import {ProcessContextModulesBase} from "~/server/dynamo/context/process_context";
import {DangerousSystemContextModule} from "~/server/dynamo/context/system_context_module";
import {Context} from "~/shared/context/context";

/**
 * Generic context for handling requests with unknown authentication state.
 */
export type SystemContext = Context<SystemContextModules>;

type SystemContextModules = ProcessContextModulesBase & {
    /**
     * The system context has access to the dangerous system context module. This
     * context module lets us impersonate other accounts to perform actions on
     * their behalf.
     */
    system: DangerousSystemContextModule;
};
