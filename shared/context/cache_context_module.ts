import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {DefaultMap} from "~/shared/helpers/map/default_map.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

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
     * `whenActorChanges: "DangerouslyShare"` between this cache context module and
     * the new cache context module. See the documentation on `whenActorChanges`
     * for more info.
     */
    public forkForChangedActor() {
        const module = new CacheContextModule();

        for (const [cache, cacheMap] of this._caches) {
            if (cache.whenActorChanges === "SafelyReset") continue;
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
     * What should happen to the cache when the actor changes? Should we share
     * the cache's contents with the new action or should we reset the cache? The
     * actor may change within an action through a
     * `dangerouslyEscalateToSystemContext()` call or an
     * `impersonateAccountAsSystemContext()` call.
     *
     * If the value is `DangerouslyShare` then the cache will be shared between the
     * action context for the old actor and new actor. If we add to the cache as
     * the old actor it can be read as the new actor and vice versa. You should
     * only use `Share` if cache values don't depend on the actor! This option is
     * the most performant since we get more cache hits.
     *
     * If the value is `SafelyReset` then we create a new, empty, cache for the new
     * context and if we write a value to this new cache it won't be propagated
     * back to the old cache. This option is safer since if a system actor writes a
     * value to the cache with escalated permissions it won't be seen by the
     * session actor.
     */
    public readonly whenActorChanges: "DangerouslyShare" | "SafelyReset";

    constructor({whenActorChanges}: {whenActorChanges: "DangerouslyShare" | "SafelyReset"}) {
        this.whenActorChanges = whenActorChanges;
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
     * Get a value from our cache if one exists and return null otherwise.
     */
    public getIfExists(
        context: Context<{cache: CacheContextModule}>,
        key: Key,
    ): Promise<Value> | null {
        const cacheMap = context.cache._getCacheMap(this);
        return cacheMap.get(key) ?? null;
    }

    /**
     * Unconditionally sets a value in the cache. If a value already exists in the
     * cache then this function will overwrite it.
     */
    public set(
        context: Context<{cache: CacheContextModule}>,
        key: Key,
        value: MaybePromise<Value>,
    ): void {
        const cacheMap = context.cache._getCacheMap(this);
        cacheMap.set(key, Promise.resolve(value));
    }
}
