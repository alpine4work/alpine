import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {createAggregateError} from "~/shared/error/aggregate_error.js";
import {DeadlineExceededError} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isTestNodeEnvOrAdminScenariosScript} from "~/shared/helpers/test/is_test_node_env_or_admin_scenarios_script.js";
import {SafeFloatingPromise} from "~/shared/helpers/types/safe_floating_promise.js";

// We grab the original `setTimeout` here since we want to set a timeout without
// being affected by Jest fake timers.
const originalSetTimeout = setTimeout;

/**
 * This context provides information about the process our code is running in and
 * allows extending the lifetime of the process for code running in serverless-like
 * environments with the `waitUntil()` function (e.g. Cloudflare Workers and
 * Cloudflare Durable Objects).
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
     * [1]:
     *     https://developers.cloudflare.com/workers/runtime-apis/fetch-event/#waituntil
     */
    public waitUntil(
        action: Promise<unknown> | (() => Promise<unknown>),
    ): SafeFloatingPromise<void> {
        const promise = typeof action === "function" ? action() : action;

        // @ts-expect-error: This `_waitUntil()` method exists on the `Context` object
        // but it's marked as private since we only want the function here to call it.
        // Ignore the TypeScript error complaining this method is private.
        this._context._waitUntil(promise);

        this._waitUntil(promise);

        return promise as SafeFloatingPromise<void>;
    }

    public fork() {
        return new ProcessContextModule({waitUntil: this._waitUntil});
    }

    /**
     * Create an implementation of this context module for tests.
     */
    public static test({afterEach}: {afterEach: (action: () => Promise<void>) => void}) {
        assert(isTestNodeEnvOrAdminScenariosScript);

        // Install an after each hook to wait for tasks.
        afterEach(async () => {
            await ProcessContextModule.waitForTestTasks();
        });

        return new ProcessContextModule({
            waitUntil: promise => {
                const modifiedPromise = Object.assign(promise, {
                    deadlineExceededError: new DeadlineExceededError(
                        "`ProcessContextModule.waitForTestTasks()` has been waiting for promise for over 5 seconds",
                    ),
                });

                // Don't treat errors as unhandled. They will be reported in `afterEach()`.
                modifiedPromise.then(
                    () => {
                        assertExists(afterEachPromisesForTest).delete(modifiedPromise);
                    },
                    () => {
                        assertExists(afterEachPromisesForTest).delete(modifiedPromise);
                    },
                );

                assertExists(afterEachPromisesForTest).add(modifiedPromise);
            },
        });
    }

    private static _waitForTestTasksPromise?: Promise<void>;

    /**
     * Whether there are any pending `waitUntil()` test tasks that `waitForTestTasks()`
     * would wait on.
     *
     * Useful for draining background work to a fixed point. Processing a job can
     * register new `waitUntil()` tasks (e.g. enqueueing a follow-up job) and those
     * tasks can in turn enqueue more jobs, so a single drain pass may finish before
     * everything settles. Callers can alternate `waitForTestTasks()` and job-queue
     * draining until this returns `false`.
     */
    public static hasPendingTestTasks(): boolean {
        assert(isTestNodeEnvOrAdminScenariosScript);
        assert(afterEachPromisesForTest);
        return afterEachPromisesForTest.size > 0;
    }

    /**
     * Wait for all the promises passed into the `waitUntil()` function of
     * `ProcessContextModule.test()`s to resolve.
     */
    public static waitForTestTasks({
        withoutDeadlineExceededLog = false,
    }: {
        withoutDeadlineExceededLog?: boolean;
    } = {}): Promise<void> {
        assert(isTestNodeEnvOrAdminScenariosScript);
        assert(afterEachPromisesForTest);

        // Must early return when there are no promises since otherwise
        // `this._waitForTestTasksPromise` won't get cleared since the `finally` which
        // clears `this._waitForTestTasksPromise` will run before the promise is assigned.
        if (!(afterEachPromisesForTest.size > 0)) return Promise.resolve();

        if (this._waitForTestTasksPromise === undefined) {
            let isSync = true;

            this._waitForTestTasksPromise = (async () => {
                try {
                    const errors: Array<unknown> = [];

                    // Wait for all promises to resolve. If there's an error, don't throw it until all
                    // promises have resolved.
                    while (afterEachPromisesForTest.size > 0) {
                        const promises = afterEachPromisesForTest;
                        afterEachPromisesForTest = new Set();

                        if (!withoutDeadlineExceededLog) {
                            // Log a warning when we've been waiting on a promise for too long. We construct
                            // the error in the `waitUntil()` call so we can trace the source of the promise.
                            for (const promise of promises) {
                                const timeoutId = originalSetTimeout(() => {
                                    // eslint-disable-next-line no-console
                                    console.error(promise.deadlineExceededError);
                                }, 5000);

                                void promise.catch(() => {}).finally(() => clearTimeout(timeoutId));
                            }
                        }

                        try {
                            await runAllPromises(promises);
                        } catch (error) {
                            errors.push(error);
                        }
                    }

                    if (errors.length > 0) {
                        throw createAggregateError(errors);
                    }
                } finally {
                    // Double check that we're not running synchronously when we reach this point.
                    // Otherwise `this._waitPromise` will be not be properly cleared.
                    assert(!isSync);

                    this._waitForTestTasksPromise = undefined;
                }
            })();

            isSync = false;
        }

        return this._waitForTestTasksPromise;
    }
}

let afterEachPromisesForTest: Set<Promise<unknown> & {deadlineExceededError: Error}> | null =
    isTestNodeEnvOrAdminScenariosScript ? new Set() : null;
