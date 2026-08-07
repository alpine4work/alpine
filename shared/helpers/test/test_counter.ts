import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {
    StringifiableValueForDeepEqualCheck,
    stringifyForDeepEqualCheck,
} from "~/shared/helpers/control/stringify_for_deep_equal_check.open_source.js";

/**
 * A test helper for determining how often a given operation happens over the
 * course of a test. Useful for testing performance optimizations where you want to
 * make sure we're not calling some expensive piece of code.
 */
export class TestCounter<Key extends StringifiableValueForDeepEqualCheck | void> {
    private _count = 0;
    private _countByKey = new Map<string, number>();

    constructor() {
        // After each test, clear our counts so we don't have a memory leak.
        if (typeof afterEach !== "undefined") {
            assert(import.meta.jest);

            afterEach(() => {
                this.resetForTest();
            });
        }
    }

    /**
     * Reset all counters to 0.
     */
    public resetForTest() {
        assert(import.meta.jest);

        this._count = 0;

        for (const key of this._countByKey.keys()) {
            this._countByKey.set(key, 0);
        }
    }

    /**
     * Increment the count for the provided key. Will only increment the count if we
     * are recording with `recordForTest()`.
     */
    public incrementForTest(key: Key, n: number = 1): void {
        if (!import.meta.jest) return;

        assert(Number.isInteger(n) && n >= 1);

        this._count += n;

        const keyString = key !== undefined ? stringifyForDeepEqualCheck(key) : "undefined";
        const count = this._countByKey.get(keyString);

        // If there is no count, we aren't recording the count for this request. Don't set
        // a count in our map since that may cause memory issues.
        if (count === undefined) return;

        this._countByKey.set(keyString, count + n);
    }

    /**
     * Starts recording a count for the provided key. Any changes to the count before
     * this call won't be represented. Call the returned `getCount` function for the
     * current count.
     *
     * Will throw outside of a test environment.
     */
    public recordForTest(key: Key): {getCount: () => number} {
        assert(import.meta.jest);

        const keyString = key !== undefined ? stringifyForDeepEqualCheck(key) : "undefined";

        if (!this._countByKey.has(keyString)) {
            this._countByKey.set(keyString, 0);
        }

        return {
            getCount: () => {
                const count = this._countByKey.get(keyString);
                assert(
                    count !== undefined,
                    "Not recording count for this request, the test probably finished and we reset our state",
                );
                return count;
            },
        };
    }

    /**
     * Starts recording a count across all keys. Call the returned `getCount` function
     * for the current count.
     *
     * Will throw outside of a test environment.
     */
    public recordAllForTest(): {getCount: () => number} {
        assert(import.meta.jest);

        return {getCount: () => this._count};
    }
}
