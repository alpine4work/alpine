import {InternalError} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";

/**
 * Object describing the context in which our server code executes.
 */
// NOTE(calebmer): I expect this to get more features over time. Including
// tracing and authentication.
export abstract class ServerContext {
    /**
     * Don't let the process exit until this promise has completed.
     *
     * Errors will be handled and attached to the execution trace.
     *
     * See the [Cloudflare documentation][1] for this method.
     *
     * [1]: https://developers.cloudflare.com/workers/runtime-apis/fetch-event/#waituntil
     */
    // TODO(calebmer): Error handling! Unhandled exceptions should not crash
    // the process.
    public abstract waitUntil(promise: Promise<void>): void;
}

export class DurableObjectServerContext extends ServerContext {
    constructor(private readonly _state: DurableObjectState) {
        super();
    }

    public waitUntil(promise: Promise<void>): void {
        this._state.waitUntil(promise);
    }
}

let jestAfterEachPromises: Array<Promise<void>> = [];

if (typeof jest !== "undefined") {
    afterEach(async () => {
        while (jestAfterEachPromises.length > 0) {
            const promises = jestAfterEachPromises;
            jestAfterEachPromises = [];
            await runAllPromises(promises);
        }
    });
}

export class TestServerContext extends ServerContext {
    /**
     * Wait for all the promises passed into the `waitUntil()` function of
     * `TestServerContext`s to resolve.
     */
    public static async waitForTasks() {
        assert(typeof jest !== "undefined");

        while (jestAfterEachPromises.length > 0) {
            const promises = jestAfterEachPromises;
            jestAfterEachPromises = [];
            await runAllPromises(promises);
        }
    }

    constructor() {
        if (typeof jest === "undefined")
            throw new InternalError("May only construct a test server context in Jest tests");

        super();
    }

    public waitUntil(promise: Promise<void>): void {
        jestAfterEachPromises.push(promise);
    }
}
