import jsonStableStringify from "json-stable-stringify";
import {assert} from "~/shared/helpers/control/assert.js";
import {SchemaSerializedValue} from "~/shared/schema/schema.js";

/**
 * A test helper for determining how often a given operation happens over the
 * course of a test. Useful for testing performance optimizations where you
 * want to make sure we're not calling some expensive piece of code.
 */
export class TestCounter<
    // We set `SchemaSerializedValue` as the bound so that `Key` is
    // JSON stringifiable.
    Key extends SchemaSerializedValue,
> {
    private _countByKey = new Map<string, number>();

    constructor() {
        // After each test, clear our counts so we don't have a memory leak.
        if (import.meta.jest) {
            afterEach(() => {
                this._countByKey.clear();
            });
        }
    }

    /**
     * Increment the count for the provided key. Will only increment
     * the count if we are recording with `recordForTest()`.
     */
    public incrementForTest(key: Key): void {
        if (!import.meta.jest) return;

        const keyString = jsonStableStringify(key);
        const count = this._countByKey.get(keyString);

        // If there is no count, we aren't recording the count for this request. Don't
        // set a count in our map since that will cause a memory leak in production.
        if (count === undefined) return;

        this._countByKey.set(keyString, count + 1);
    }

    /**
     * Starts recording a count for the provided key. Any changes to
     * the count before this call won't be represented. Call the returned
     * `getCount` function for the current count.
     *
     * Will throw outside of a test environment.
     */
    public recordForTest(key: Key): {getCount: () => number} {
        assert(import.meta.jest);

        const keyString = jsonStableStringify(key);

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
}
