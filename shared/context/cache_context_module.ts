import {Context} from "~/shared/context/context.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";
import {ForkableContextModuleBase} from "~/shared/context/fork_action_context_module.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {TestCounter} from "~/shared/helpers/test/test_counter.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

export const contextCacheMissTestCounter = new TestCounter<string | number>();

/**
 * A context module used for caching values for the lifetime of a context. Used
 * in conjunction with `ContextCache`.
 */
export class CacheContextModule extends ContextModuleBase implements ForkableContextModuleBase {
    private readonly _sharedCaches: Map<ContextCache<any, any>, Map<any, Promise<any>>> | null;
    private readonly _caches = new Map<ContextCache<any, any>, Map<any, Promise<any>>>();

    private constructor(sharedCaches: Map<ContextCache<any, any>, Map<any, Promise<any>>> | null) {
        super();
        this._sharedCaches = sharedCaches;
    }

    public static new() {
        return new CacheContextModule(null);
    }

    /**
     * Get the map storing values for this cache. This should only be called by
     * `ContextCache`. It needs to be public so TypeScript doesn't complain.
     */
    public _getCacheMap<Key extends string | number, Value>(
        cache: ContextCache<Key, Value>,
    ): Map<Key, Promise<Value>> {
        if (cache.whenActorChanges !== "DangerouslyShare") {
            return getOrSetDefaultMapValue(this._caches, cache, () => new Map());
        } else {
            return getOrSetDefaultMapValue(
                this._sharedCaches ?? this._caches,
                cache,
                () => new Map(),
            );
        }
    }

    public fork() {
        // Cache is not reused when we fork! Fork may be long after the original action
        // so we want a cache with a new lifetime.
        return new CacheContextModule(null);
    }

    /**
     * Create a new `CacheContextModule` and share any caches that set
     * `whenActorChanges: "DangerouslyShare"` between this cache context module and
     * the new cache context module. See the documentation on `whenActorChanges`
     * for more info.
     */
    public forkForChangedActor() {
        return new CacheContextModule(this._sharedCaches ?? this._caches);
    }
}

/**
 * Cache for values that live as long as the context. The context needs a
 * `CacheContextModule` for you to cache data associated with the context.
 *
 * You typically use this to implement caching while serving a single request.
 */
export class ContextCache<Key extends string | number, Value> {
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
     * only use `DangerouslyShare` if cache values don't depend on the actor! This
     * option is the most performant since we get more cache hits.
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

        return getOrSetDefaultMapValue(cacheMap, key, () => {
            if (import.meta.jest) contextCacheMissTestCounter.incrementForTest(key);
            return getDefault();
        });
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

    /**
     * Unconditionally remove a value from the cache. The next time we try to read
     * the key from the cache it'll be repopulated.
     */
    public delete(context: Context<{cache: CacheContextModule}>, key: Key): void {
        const cacheMap = context.cache._getCacheMap(this);
        cacheMap.delete(key);
    }
}
