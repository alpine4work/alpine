import {RequestContext} from "~/server/request/request-context";
import {assert} from "~/shared/helpers/control/assert";
import {Id} from "~/shared/id/id";

/**
 * A test helper for determining how often a given operation happens over the
 * course of a test. Useful for testing performance optimizations where you
 * want to make sure we're not calling some expensive piece of code.
 */
export class RequestTestCounter {
    private _countByRequestId = new Map<Id, number>();

    constructor() {
        // After each test, clear our counts so we don't have a memory leak.
        if (typeof jest !== "undefined") {
            afterEach(() => {
                this._countByRequestId.clear();
            });
        }
    }

    /**
     * Increment the count for the provided request context. Will only increment
     * the count if we are recording with `recordForTest()`.
     */
    public incrementForTest(context: RequestContext): void {
        const count = this._countByRequestId.get(context.requestId);

        // If there is no count, we aren't recording the count for this request. Don't
        // set a count in our map since that will cause a memory leak in production.
        if (count === undefined) return;

        this._countByRequestId.set(context.requestId, count + 1);
    }

    /**
     * Starts recording a count for the provided request context. Any changes to
     * the count before this call won't be represented. Call the returned
     * `getCount` function for the current count.
     *
     * Will throw outside of a test environment.
     */
    public recordForTest(context: RequestContext): {getCount: () => number} {
        assert(typeof jest !== "undefined");

        if (!this._countByRequestId.has(context.requestId)) {
            this._countByRequestId.set(context.requestId, 0);
        }

        return {
            getCount: () => {
                const count = this._countByRequestId.get(context.requestId);
                assert(
                    count !== undefined,
                    "Not recording count for this request, the test probably finished and we reset our state",
                );
                return count;
            },
        };
    }
}
