import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";

export type ServerConstantsContextModuleOptions = {
    readonly edgeServiceUrl: string;
};

/**
 * This context makes broadly useful immutable constants available at runtime.
 * @param {string} options.edgeServiceUrl - Defines the Edge Service URL which is the entrypoint into Alpine.
 */
export class ServerConstantsContextModule
    extends ContextModuleBase
    implements ForkableContextModuleBase
{
    public readonly edgeServiceUrl: string;

    constructor(options: ServerConstantsContextModuleOptions) {
        super();
        this.edgeServiceUrl = options.edgeServiceUrl;
    }

    public fork() {
        return new ServerConstantsContextModule({edgeServiceUrl: this.edgeServiceUrl});
    }
}
