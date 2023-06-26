import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * This context provides information about the process our code is running in
 * and allows extending the lifetime of the process for code running in
 * serverless-like environments with the `waitUntil()` function
 * (e.g. Cloudflare Workers and Cloudflare Durable Objects).
 */
export class ProcessContextModule extends ContextModuleBase {
    private readonly _waitUntil: (promise: Promise<void>) => void;

    constructor({waitUntil}: {waitUntil: (promise: Promise<void>) => void}) {
        super();
        this._waitUntil = waitUntil;
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

    /**
     * Don't let the process exit until this promise has completed.
     *
     * Errors will be handled and attached to the execution trace.
     *
     * See the [Cloudflare documentation][1] for this method.
     *
     * [1]: https://developers.cloudflare.com/workers/runtime-apis/fetch-event/#waituntil
     */
    public waitUntil(action: Promise<void> | (() => Promise<void>)): void {
        // TODO(calebmer): Error handling! Unhandled exceptions should not crash
        // the process.
        this._waitUntil(typeof action === "function" ? action() : action);
    }

    /**
     * Wait for all the promises passed into the `waitUntil()` function of
     * `ProcessContextModule.test()`s to resolve.
     */
    public static async waitForTestTasks() {
        assert(process.env.NODE_ENV === "test");

        while (afterEachPromisesForTest.length > 0) {
            const promises = afterEachPromisesForTest;
            afterEachPromisesForTest = [];
            await runAllPromises(promises);
        }
    }
}

let afterEachPromisesForTest: Array<Promise<unknown>> = [];
