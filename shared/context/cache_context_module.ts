import {Context} from "~/shared/context/context";
import {ContextModuleBase} from "~/shared/context/context_module_base";
import {DefaultMap} from "~/shared/helpers/map/default_map";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value";
import {generateId} from "~/shared/id/id";

/**
 * A context module used for caching values for the lifetime of a context. Used
 * in conjunction with `ContextCache`.
 */
export class CacheContextModule extends ContextModuleBase {
    private readonly _caches = new DefaultMap<ContextCache<any, any>, Map<any, Promise<any>>>(
        () => new Map(),
    );

    /**
     * Get the map storing values for this cache. This should only be called by
     * `ContextCache`. It needs to be public so TypeScript doesn't complain.
     */
    public _getCacheMap<Key, Value>(cache: ContextCache<Key, Value>): Map<Key, Promise<Value>> {
        return this._caches.getOrSetDefault(cache);
    }
}

/**
 * Cache for values that live as long as the context. The context needs a
 * `CacheContextModule` for you to cache data associated with the context.
 *
 * You typically use this to implement caching while serving a single request.
 */
export class ContextCache<Key, Value> {
    /**
     * Get a value from our cache and if a value doesn't exist we will call the
     * provided function to populate the cache with a value.
     */
    public get(
        context: Context<{cache: CacheContextModule}>,
        key: Key,
        getDefault: () => Promise<Value>,
    ): Promise<Value> {
        const cacheMap = context.cache._getCacheMap(this);
        return getOrSetDefaultMapValue(cacheMap, key, () =>
            Object.assign(getDefault(), {_debugId: generateId()}),
        );
    }
}
