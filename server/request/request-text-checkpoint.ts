import {RequestContext} from "~/server/request/request-context";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise-resolver";
import {assert} from "~/shared/helpers/control/assert";
import {Id} from "~/shared/id/id";

/**
 * A test helper for emulating race conditions. You can add a `waitForTest()`
 * checkpoint call to your code and then in a test call `pauseForTest()`. The
 * request will wait until your test unpauses.
 */
export class RequestTextCheckpoint {
    private _promiseResolverByRequestId = new Map<Id, PromiseResolver<PromiseResolver<void>>>();

    /**
     * Call this at the point in your code where you want to emulate a race
     * condition. If a test has paused the code then we'll only resolve when the
     * test unpauses.
     */
    public async waitForTest(context: RequestContext): Promise<void> {
        const promiseResolver1 = this._promiseResolverByRequestId.get(context.requestId);
        if (!promiseResolver1) return;

        const promiseResolver2 = createPromiseResolver();
        promiseResolver1.resolve(promiseResolver2);
        await promiseResolver2.promise;
    }

    /**
     * Pause the checkpoint for a request with a matching request id. Call unpause
     * when you want the checkpoint to resume.
     *
     * This promise will resolve when `waitForTest()` is called for the
     * provided request.
     *
     * Will throw if called outside of a test environment.
     */
    public async pauseForTest(context: RequestContext): Promise<{unpause: () => void}> {
        assert(process.env.NODE_ENV === "test");

        assert(!this._promiseResolverByRequestId.has(context.requestId), "Request already paused");

        const promiseResolver1 = createPromiseResolver<PromiseResolver<void>>();
        this._promiseResolverByRequestId.set(context.requestId, promiseResolver1);

        const promiseResolver2 = await promiseResolver1.promise;

        return {unpause: () => promiseResolver2.resolve()};
    }
}
