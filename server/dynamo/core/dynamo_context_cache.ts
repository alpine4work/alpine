import {DynamoContextModule} from "~/server/dynamo/core/dynamo_context_module.js";
import {
    DynamoCacheReadConsistency,
    DynamoReadConsistency,
} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {getDynamoExpectsStrongReadConsistency} from "~/server/dynamo/core/internal/get_dynamo_client.js";
import {CacheContextModule, ContextCache} from "~/shared/context/cache_context_module.js";
import {Context} from "~/shared/context/context.js";
import {TracerContextModule} from "~/shared/context/tracer_context_module.js";
import {InternalError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

/**
 * A specialized `ContextCache` for DynamoDB data that respects DynamoDB read
 * consistency. If you read from the cache with `Eventual` consistency we can
 * return any previously loaded data in the cache. If you read from the cache with
 * `Strong` consistency we always reload the data. However, if you read from the
 * cache with the special `StrongWithinCache` consistency then we'll only reload
 * the data if it was previously loaded with `Eventual` consistency. That way
 * you're guaranteed to have a strongly consistent read since cache creation time
 * (which usually corresponds with action start time in the case of a context like
 * `ServerActionContext`).
 */
export class DynamoContextCache<Key extends string | number, Value> {
    private readonly _cache: ContextCache<
        Key,
        {
            readonly consistency: DynamoReadConsistency;
            readonly value: Value;
        }
    >;

    constructor(options: {whenActorChanges: "DangerouslyShare" | "SafelyReset"}) {
        this._cache = new ContextCache(options);
    }

    /**
     * Get the value at `key` from our cache with the provided `consistency`.
     *
     * - If `Eventual` then we always return the value if it was previously loaded
     *   regardless of the value's `consistency`. If there's no value present then we
     *   call `getDefault()` with eventual consistency.
     *
     * - If `Strong` then we always call `getDefault()` with strong consistency
     *   ignoring what's currently in the cache. We add the loaded value to the cache.
     *
     * - If `StrongWithinCache` then if there's no value in the cache we call
     *   `getDefault()` with strong consistency. However, if there is a value in the
     *   cache then we'll use it but only if the value was loaded with `Strong`
     *   consistency (so a previous call used `Strong` or `StrongWithinCache` but not
     *   `Eventual`). If the value in the cache was loaded with eventual consistency
     *   then we call `getDefault()` with strong consistency and replace the value in
     *   the cache.
     */
    public async get(
        context: Context<{
            tracer: TracerContextModule;
            cache: CacheContextModule;
            dynamo: DynamoContextModule;
        }>,
        consistencyOrOptions:
            | DynamoCacheReadConsistency
            | {consistency: DynamoCacheReadConsistency; allowsEventualReadConsistency?: boolean},
        key: Key,
        getDefault: (consistency: DynamoReadConsistency) => Promise<Value>,
    ): Promise<Value> {
        const consistency =
            typeof consistencyOrOptions === "string"
                ? consistencyOrOptions
                : consistencyOrOptions.consistency;

        const allowsEventualReadConsistency =
            typeof consistencyOrOptions === "object"
                ? (consistencyOrOptions.allowsEventualReadConsistency ?? false)
                : false;

        switch (consistency) {
            case "Eventual": {
                // Make sure to report an error if we expect to use strong consistency but instead
                // get an eventually consistent read.
                if (
                    !allowsEventualReadConsistency &&
                    getDynamoExpectsStrongReadConsistency(context)
                ) {
                    const error = new InternalError(
                        `Expected DynamoDB strong consistency when reading${
                            // Don't key in error message in production! Since the key may contain sensitive
                            // user data.
                            process.env.NODE_ENV !== "production" ? ` key ${quote(key)} ` : " "
                        }from context cache`,
                    );

                    if (process.env.NODE_ENV !== "production") {
                        throw error;
                    } else {
                        // In production, log an error but let the method return like normal. In case a
                        // developer accidentally forgot to make a read strong consistency it's probably
                        // fine to log a warning without breaking the product.
                        context.tracer.logException("Expected DynamoDB strong consistency", error);
                    }
                }

                const entry = await this._cache.get(context, key, async () => {
                    const value = await getDefault("Eventual");
                    return {consistency: "Eventual", value};
                });

                return entry.value;
            }
            case "Strong": {
                const valuePromise = getDefault("Strong");

                const entryPromise = valuePromise.then(value => ({
                    consistency: "Strong" as const,
                    value,
                }));

                // Ignore unhandled errors. Errors of `valuePromise` should be handled by this
                // function's caller.
                entryPromise.catch(() => {});

                this._cache.set(context, key, entryPromise);

                const value = await valuePromise;
                return value;
            }
            case "StrongWithinCache": {
                const entry = await this._cache.get(context, key, async () => {
                    const value = await getDefault("Strong");
                    return {consistency: "Strong", value};
                });

                if (entry.consistency !== "Strong") {
                    return this.get(context, "Strong", key, getDefault);
                }

                return entry.value;
            }
            default:
                throw exhaustive(consistency);
        }
    }

    /**
     * Get a value from the cache if such an entry exists. No matter what consistency
     * the value was read with. Returns null otherwise.
     */
    public getIfExists(
        context: Context<{cache: CacheContextModule}>,
        consistency: DynamoCacheReadConsistency,
        key: Key,
    ): Promise<Value | null> | null {
        if (consistency === "Strong") return null;

        return (
            this._cache.getIfExists(context, key)?.then(entry => {
                switch (consistency) {
                    case "Eventual": {
                        return entry.value;
                    }
                    case "StrongWithinCache": {
                        switch (entry.consistency) {
                            case "Strong":
                                return entry.value;
                            case "Eventual":
                                return null;
                            default:
                                throw exhaustive(entry.consistency);
                        }
                    }
                    default:
                        throw exhaustive(consistency);
                }
            }) ?? null
        );
    }

    /**
     * Add the provided `value` to the cache with the provided `key` and `consistency`.
     * If `consistency` is `Eventual` then the value will only be reused if there's a
     * `get()` call with `Eventual` consistency. If `consistency` is `Strong` then the
     * value will be reused for `get()` calls that are `Eventual` consistency or
     * `StrongWithinCache` consistency.
     */
    public set(
        context: Context<{cache: CacheContextModule}>,
        consistency: DynamoCacheReadConsistency,
        key: Key,
        value: MaybePromise<Value>,
    ): void {
        const entryPromise = Promise.resolve(value).then(value => ({
            // If the value was read with `StrongWithinCache` by our DynamoDB client outside of
            // this cache then really that means the value was read with `Strong` consistency.
            // Regardless if this was from a cache or not, by putting the value in this cache
            // it can only be read back out with `StrongWithinCache` consistency so it's fine
            // to upgrade to `Strong` here.
            consistency: consistency === "StrongWithinCache" ? "Strong" : consistency,
            value,
        }));

        // Ignore unhandled errors. Errors in `value` should be handled by this function's
        // caller.
        entryPromise.catch(() => {});

        this._cache.set(context, key, entryPromise);
    }

    /**
     * Unconditionally remove a value from the cache. The next time we try to read the
     * key from the cache it'll be repopulated.
     */
    public delete(context: Context<{cache: CacheContextModule}>, key: Key): void {
        this._cache.delete(context, key);
    }
}
