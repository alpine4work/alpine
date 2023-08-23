import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * This context provides information about the process our code is running in
 * and allows extending the lifetime of the process for code running in
 * serverless-like environments with the `waitUntil()` function
 * (e.g. Cloudflare Workers and Cloudflare Durable Objects).
 */
export class ProcessContextModule extends ContextModuleBase implements ForkableContextModuleBase {
    private readonly _waitUntil: (promise: Promise<unknown>) => void;

    constructor({waitUntil}: {waitUntil: (promise: Promise<unknown>) => void}) {
        super();
        this._waitUntil = waitUntil;
    }

    /**
     * Don't let the process exit until this promise has completed.
     *
     * Errors will be handled and attached to the execution trace.
     *
     * See the [Cloudflare documentation][1] for this method.
     *
     * [1]: https://developers.cloudflare.com/workers/runtime-apis/fetch-event/#waituntil
     */
    public waitUntil(action: Promise<unknown> | (() => Promise<unknown>)): void {
        // TODO(calebmer): Error handling! Unhandled exceptions should not crash
        // the process.
        this._waitUntil(typeof action === "function" ? action() : action);
    }

    public fork() {
        return new ProcessContextModule({waitUntil: this._waitUntil});
    }

    /**
     * Create an implementation of this context module for tests.
     */
    public static test({afterEach}: {afterEach: (action: () => Promise<void>) => void}) {
        assert(process.env.NODE_ENV === "test");

        // Install an after each hook to wait for tasks.
        afterEach(async () => {
            await ProcessContextModule.waitForTestTasks();
        });

        return new ProcessContextModule({
            waitUntil: promise => {
                // Don't treat errors as unhandled. They will be reported in `afterEach()`.
                promise.catch(() => {});

                afterEachPromisesForTest.push(promise);
            },
        });
    }

    private static _waitForTestTasksPromise?: Promise<void>;

    /**
     * Wait for all the promises passed into the `waitUntil()` function of
     * `ProcessContextModule.test()`s to resolve.
     */
    public static async waitForTestTasks() {
        assert(process.env.NODE_ENV === "test");

        if (!this._waitForTestTasksPromise) {
            this._waitForTestTasksPromise = (async () => {
                while (afterEachPromisesForTest.length > 0) {
                    const promises = afterEachPromisesForTest;
                    afterEachPromisesForTest = [];
                    await runAllPromises(promises);
                }
            })().finally(() => {
                this._waitForTestTasksPromise = undefined;
            });
        }

        await this._waitForTestTasksPromise;
    }
}

let afterEachPromisesForTest: Array<Promise<unknown>> = [];
