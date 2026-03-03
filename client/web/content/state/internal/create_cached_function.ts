import {InternalError} from "~/shared/error/error.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {JsonScalarValue} from "~/shared/helpers/types/json_value.js";

/**
 * Create a function that caches its results. The function will always return the
 * exact same (referentially equal) result for the exact same (referentially equal)
 * arguments.
 *
 * It leverages `WeakMap`s so that when any object arguments are garbage collected
 * we also clean up the cached result value. We keep the cached values for any
 * non-object arguments forever.
 *
 * You need to be careful about how you design your cached function to make sure
 * you don't cause a memory leak:
 *
 * 1. Your object arguments should be released from memory when they're no longer
 *    used.
 *
 * 2. Your non-object arguments should ideally be low cardinality. In other words,
 *    they shouldn't vary much. If you have a number argument, ideally you only
 *    ever pass in one to three unique values. Otherwise the cache may grow quite
 *    large and won't ever be cleaned up.
 *
 * We require at least one object argument as a safety precaution against memory
 * leaks. If that object has a limited life time then once it's garbage collected
 * so will any associated cached values.
 */
// NOTE(calebmer, 2024-09-28): Currently this lives in
// `client/content/state/internal` instead of `shared/helpers` since it only has
// one usage (in `content_file_layout.ts`) and must be used carefully or else we'll
// have a memory leak.
//
// If this function ever gets promoted to `shared/helpers`, we should consider
// using an LRU cache for the terminal cache (`valueByArgsKey`) instead of `Map`.
// That way we don't have memory leaks when you call this function with high
// cardinality scalar values. We'd only keep around the last ~5 or so unique arg
// key combinations.
//
// If we use an LRU cache for the terminal cache maybe it's also ok to lift the
// requirement that there must be at least one object argument.
export function createCachedFunction<Args extends ReadonlyArray<object | JsonScalarValue>, Value>(
    compute: (...args: Args) => Value,
): (...args: Args) => Value {
    type Cache = WeakMap<
        object,
        {
            cache: Cache | null;
            // Our terminal cache.
            //
            // After all the `WeakMap` cached object arguments we serialize the function's
            // arguments into a string key with `JSON.stringify()`. We replace any object
            // arguments with an `@` character since it's already been cached.
            //
            // By putting this map at the end of our `WeakMap` chain (instead of the beginning)
            // if ANY of the function's object arguments are garbage collected than this map
            // will be garbage collected as well.
            valueByArgsKey: Map<string, Value> | null;
        }
    >;

    let rootCache: Cache | undefined;

    return (...args) => {
        const objects: Array<object> = [];

        for (const arg of args) {
            if (typeof arg === "object" && arg !== null) {
                objects.push(arg);
            }
        }

        rootCache ??= new WeakMap();
        let cache = rootCache;

        if (objects.length === 0) {
            throw new InternalError("Expected at least one object argument to cached function");
        }

        for (let i = 0; i < objects.length - 1; i++) {
            const cacheEntry = getOrSetDefaultMapValue(cache, objects[i]!, () => ({
                cache: null,
                valueByArgsKey: null,
            }));

            cacheEntry.cache ??= new WeakMap();
            cache = cacheEntry.cache;
        }

        const cacheEntry = getOrSetDefaultMapValue(cache, objects[objects.length - 1]!, () => ({
            cache: null,
            valueByArgsKey: null,
        }));

        cacheEntry.valueByArgsKey ??= new Map();

        const argsKey = args
            .map(arg => {
                // Add a symbol to record that there was an object here. We need to record a symbol
                // in the position of object arguments in case we have referentially equal
                // arguments that get reordered relative to some `JsonScalarValue`.
                if (typeof arg === "object" && arg !== null) return "@";

                return JSON.stringify(arg);
            })
            .join("-");

        return getOrSetDefaultMapValue(cacheEntry.valueByArgsKey, argsKey, () => compute(...args));
    };
}
