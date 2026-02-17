import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.js";

export type ConstantsContextModuleOptions = {
    readonly edgeServiceUrl: MaybeThunk<string>;
    readonly resourceServiceUrl: MaybeThunk<string>;
};

/**
 * This context makes broadly useful immutable constants available at runtime.
 */
export class ConstantsContextModule extends ContextModuleBase implements ForkableContextModuleBase {
    public readonly edgeServiceUrl!: string;
    public readonly resourceServiceUrl!: string;

    constructor(options: ConstantsContextModuleOptions) {
        super();

        for (const [key, value] of Object.entries(options)) {
            if (typeof value !== "function") {
                (this as any)[key] = value;
            } else {
                // Allow defining lazy constants in tests. Useful for
                // `withIntegrationTestEnvironment()` which needs to create the context object
                // before constants are known.
                assert(isTestNodeEnvOrAdminScenariosScript);

                Object.defineProperty(this, key, {
                    enumerable: true,
                    configurable: true,
                    get: () => {
                        const actualValue = value();

                        // If `value()` didn't throw then define the constant as an actual property
                        // (instead of a getter).
                        Object.defineProperty(this, key, {
                            enumerable: true,
                            configurable: true,
                            writable: true,
                            value: actualValue,
                        });

                        return actualValue;
                    },
                });
            }
        }
    }

    public fork() {
        return new ConstantsContextModule({
            edgeServiceUrl: this.edgeServiceUrl,
            resourceServiceUrl: this.resourceServiceUrl,
        });
    }
}
