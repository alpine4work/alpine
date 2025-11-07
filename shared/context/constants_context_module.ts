import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";

export type ConstantsContextModuleOptions = {
    readonly edgeServiceUrl: string;
    readonly resourceServiceUrl: string;
};

/**
 * This context makes broadly useful immutable constants available at runtime.
 */
export class ConstantsContextModule extends ContextModuleBase implements ForkableContextModuleBase {
    public readonly edgeServiceUrl: string;
    public readonly resourceServiceUrl: string;

    constructor(options: ConstantsContextModuleOptions) {
        super();
        this.edgeServiceUrl = options.edgeServiceUrl;
        this.resourceServiceUrl = options.resourceServiceUrl;
    }

    public fork() {
        return new ConstantsContextModule({
            edgeServiceUrl: this.edgeServiceUrl,
            resourceServiceUrl: this.resourceServiceUrl,
        });
    }
}
