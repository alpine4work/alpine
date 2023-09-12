import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";

/**
 * A context module used for caching values for the lifetime of a context. Used
 * in conjunction with `ContextCache`.
 */
export class CacheContextModule extends ContextModuleBase implements ForkableContextModuleBase {
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

    public fork() {
        // Cache is not reused when we fork! Fork may be long after the original action
        // so we want a cache with a new lifetime.
        return new CacheContextModule();
    }

    /**
     * Create a new `CacheContextModule` and share any caches that set
     * `dangerouslyAllowSharing: true` between this cache context module and the
     * new cache context module. See the documentation on `dangerouslyAllowSharing`
     * for more info.
     *
     * The API for this isn't the cleanest and the default (don't allow cache
     * sharing) is much safer so we prefix with "dangerously" to discourage usage.
     */
    public dangerouslyForkWithSharedCaches() {
        const module = new CacheContextModule();

        for (const [cache, cacheMap] of this._caches) {
            if (!cache.dangerouslyAllowSharing) continue;
            module._caches.set(cache, cacheMap);
        }

        return module;
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
     * Is this cache shareable across distinct contexts with an action?
     *
     * For example, we have this function `dangerouslyEscalateToSystemContext`. It
     * allows a scope of a session action to run with a system actor. By default,
     * the system context has completely separate caches from the session context.
     * Since we don't want privileged system data to bleed into the session context
     * and vice versa. However, some caches aren't affected by what's in the
     * context (like the actor). For these contexts we allow sharing between
     * contexts.
     *
     * The API for this isn't the cleanest and the default (don't allow cache
     * sharing) is much safer so we prefix with "dangerously" to discourage usage.
     */
    public readonly dangerouslyAllowSharing: boolean;

    constructor({
        dangerouslyAllowSharing = false,
    }: {
        dangerouslyAllowSharing?: boolean;
    } = {}) {
        this.dangerouslyAllowSharing = dangerouslyAllowSharing;
    }

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
        return getOrSetDefaultMapValue(cacheMap, key, () => getDefault());
    }

    /**
     * Unconditionally sets a value in the cache. If a value already exists in the
     * cache then this function will overwrite it.
     */
    public set(context: Context<{cache: CacheContextModule}>, key: Key, value: Value): void {
        const cacheMap = context.cache._getCacheMap(this);
        cacheMap.set(key, Promise.resolve(value));
    }
}
