import {useEffect, useRef, useState} from "react";
import {unstable_IdlePriority, unstable_scheduleCallback} from "scheduler";
import {createGlobalContext, useGlobalContext} from "~/client/helpers/global_context.js";
import {useStore} from "~/client/helpers/use_store.js";
import {FailedPreconditionError, InternalError} from "~/shared/error/error.js";
import {PromiseState} from "~/shared/helpers/async/promise_state.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {undefinedStore} from "~/shared/store/const_store.js";
import {createPromiseStore} from "~/shared/store/promise_store.js";
import {Store} from "~/shared/store/store.js";
import {StoreMap} from "~/shared/store/store_map.js";

/**
 * Amount of time we wait before expiring an entry from the SWR cache. This may
 * be observed by a user if they quickly switch between states as they won't
 * have to wait for network requests.
 *
 * This should probably be configurable. We can throwaway combobox search
 * results faster than affinitive search entity lists.
 */
const swrCacheEntryExpirationDurationMs = 20 * 1000;

/**
 * Cache for SWR data shared across our React app.
 */
class SwrCache {
    private _isDestroyed = false;
    private readonly _documentVisibilityChangeListener: () => void;
    private readonly _windowOnlineListener: () => void;
    private readonly _windowOfflineListener: () => void;

    // Default to assuming we're online like `swr`:
    // https://github.com/vercel/swr/blob/ef63a30cf69f286f9b2a9f1109674a0fca541ab5/_internal/src/utils/web-preset.ts#L5-L12
    private _isOnline = true;
    private _isBrowserActive: boolean;

    private readonly _entryStackByKey = new StoreMap<string, SwrCacheEntryStack>();

    private readonly _referenceStateByKey = new Map<
        string,
        {
            referenceCount: number;
            expirationTimeout: Timeout | null;
        }
    >();

    private readonly _browserActivatedEmitter = new EventEmitter();

    constructor() {
        this._isBrowserActive =
            this._isOnline &&
            typeof document !== "undefined" &&
            document.visibilityState === "visible";

        this._documentVisibilityChangeListener = () => {
            this._onBrowserStateChange();
        };

        this._windowOnlineListener = () => {
            this._isOnline = true;
            this._onBrowserStateChange();
        };

        this._windowOfflineListener = () => {
            this._isOnline = false;
            this._onBrowserStateChange();
        };

        if (typeof document !== "undefined") {
            document.addEventListener("visibilitychange", this._documentVisibilityChangeListener);
        }

        if (typeof window !== "undefined") {
            window.addEventListener("online", this._windowOnlineListener);
            window.addEventListener("offline", this._windowOfflineListener);
        }
    }

    public destroy() {
        assert(!this._isDestroyed);
        this._isDestroyed = true;

        if (typeof document !== "undefined") {
            document.removeEventListener(
                "visibilitychange",
                this._documentVisibilityChangeListener,
            );
        }

        if (typeof window !== "undefined") {
            window.removeEventListener("online", this._windowOnlineListener);
            window.removeEventListener("offline", this._windowOfflineListener);
        }
    }

    private _onBrowserStateChange() {
        const wasBrowserActive = this._isBrowserActive;
        this._isBrowserActive = this._isOnline && document.visibilityState === "visible";

        if (!wasBrowserActive && this._isBrowserActive) {
            this._browserActivatedEmitter.emit();
        }
    }

    public subscribeToBrowserActivated(listener: () => void) {
        return this._browserActivatedEmitter.subscribe(listener);
    }

    /**
     * Get the cache entry associated with this key.
     */
    public getEntryStack(key: string) {
        return this._entryStackByKey.get(key);
    }

    /**
     * Retain cached data for the provided key. Multiple components may retain the
     * same data. We won't delete the data from the cache until the entry is fully
     * released.
     */
    public retainEntry(key: string) {
        const referenceState = getOrSetDefaultMapValue(this._referenceStateByKey, key, () => ({
            referenceCount: 0,
            expirationTimeout: null,
        }));

        referenceState.referenceCount += 1;

        if (referenceState.expirationTimeout) {
            referenceState.expirationTimeout.clear();
            referenceState.expirationTimeout = null;
        }
    }

    /**
     * Release cached data for the provided key. Once the entry has been fully
     * released we delete the data after our expiration timeout from the cache so
     * it can be garbage collected.
     */
    public releaseEntry(key: string) {
        const referenceState = this._referenceStateByKey.get(key);

        assert(referenceState && referenceState.referenceCount > 0, "Entry is already released");

        referenceState.referenceCount -= 1;

        if (referenceState.referenceCount === 0) {
            referenceState.expirationTimeout = createTimeout(() => {
                this._referenceStateByKey.delete(key);
                this._entryStackByKey.delete(key);
            }, swrCacheEntryExpirationDurationMs);
        }
    }

    /**
     * Revalidate an entry with the provided fetcher function. May not revalidate
     * if the entry was previously validated and we're within the
     * `dedupingInterval` of that previous validation.
     */
    public revalidateEntry(
        key: string,
        fetcher: (key: string) => PromiseLike<object>,
        options: {dedupingInterval: number},
    ) {
        const referenceState = this._referenceStateByKey.get(key);
        if (!((referenceState?.referenceCount ?? 0) > 0)) {
            throw new FailedPreconditionError("Must retain entry before it can be referenced");
        }

        const currentTime = Date.now();
        const entryStack = this._entryStackByKey.getSnapshot(key);

        if (
            entryStack === undefined ||
            entryStack.lastDedupingIntervalExpirationTime <= currentTime
        ) {
            this._forceRevalidateEntry(key, fetcher, options, currentTime, entryStack);
        }
    }

    /**
     * Always force revalidation of an entry with the provided fetcher function.
     */
    public forceRevalidateEntry(
        key: string,
        fetcher: (key: string) => PromiseLike<object>,
        options: {dedupingInterval: number},
    ) {
        const referenceState = this._referenceStateByKey.get(key);
        if (!((referenceState?.referenceCount ?? 0) > 0)) {
            throw new FailedPreconditionError("Must retain entry before it can be referenced");
        }

        const currentTime = Date.now();
        const entryStack = this._entryStackByKey.getSnapshot(key);

        this._forceRevalidateEntry(key, fetcher, options, currentTime, entryStack);
    }

    /**
     * Revalidate an entry with the provided fetcher function but only if the entry
     * has not yet been initialized in the cache. If the entry is available in our
     * cache do nothing.
     *
     * Useful for preloading. When preloading we only want to make sure an entry is
     * available so we have some data to show later. It's ok if the entry is stale.
     */
    public revalidateEntryIfNotAvailable(
        key: string,
        fetcher: (key: string) => PromiseLike<object>,
        options: {dedupingInterval: number},
    ) {
        const referenceState = this._referenceStateByKey.get(key);
        if (!((referenceState?.referenceCount ?? 0) > 0)) {
            throw new FailedPreconditionError("Must retain entry before it can be referenced");
        }

        const currentTime = Date.now();
        const entryStack = this._entryStackByKey.getSnapshot(key);

        if (entryStack === undefined) {
            this._forceRevalidateEntry(key, fetcher, options, currentTime, entryStack);
        }
    }

    private _forceRevalidateEntry(
        key: string,
        fetcher: (key: string) => PromiseLike<object>,
        {dedupingInterval}: {dedupingInterval: number},
        currentTime: number,
        entryStack: SwrCacheEntryStack | undefined,
    ) {
        const dedupingIntervalExpirationTime = currentTime + dedupingInterval;
        const dataPromise = fetcher(key);
        const dataStore = createPromiseStore(dataPromise);

        entryStack =
            entryStack?.push({dedupingIntervalExpirationTime, dataStore}) ??
            createSwrCacheEntryStack([{dedupingIntervalExpirationTime, dataStore}]);

        this._entryStackByKey.set(key, entryStack);
    }
}

type SwrCacheEntryResult = {
    readonly isLoading: boolean;
    readonly isValidating: boolean;
    readonly data: object | null;
};

const pendingSwrCacheEntryResult: SwrCacheEntryResult = {
    isLoading: true,
    isValidating: true,
    data: null,
};

const disabledSwrCacheEntryResult: SwrCacheEntryResult = {
    isLoading: false,
    isValidating: true,
    data: null,
};

/**
 * An entry in our SWR cache. A cache entry acts like a stack. We present the
 * last loaded data for this entry even if the entry is revalidating.
 */
type SwrCacheEntryStack = Store<SwrCacheEntryResult> & {
    /**
     * The time at which a `revalidate()` call must issue a new request and can't
     * reuse the existing data in our entry.
     */
    readonly lastDedupingIntervalExpirationTime: number;

    /**
     * Add a new asynchronous request to our entry. Once the request has resolved
     * we will return its data. Until then we will return the last asynchronous
     * data to be resolved that was pushed to our entry.
     */
    push(item: {
        dedupingIntervalExpirationTime: number;
        dataStore: Store<PromiseState<object>>;
    }): SwrCacheEntryStack;
};

function createSwrCacheEntryStack(
    stack: ReadonlyArray<{
        dedupingIntervalExpirationTime: number;
        dataStore: Store<PromiseState<object>>;
    }>,
): SwrCacheEntryStack {
    assert(stack.length > 0, "Stack should be non-empty");
    const {dedupingIntervalExpirationTime: lastDedupingIntervalExpirationTime} =
        stack[stack.length - 1]!;

    const push = (item: {
        dedupingIntervalExpirationTime: number;
        dataStore: Store<PromiseState<object>>;
    }): SwrCacheEntryStack => {
        return createSwrCacheEntryStack([...stack, item]);
    };

    const store = computeStore((get): SwrCacheEntryResult => {
        for (let i = stack.length - 1; i >= 0; i--) {
            const {dataStore} = stack[i]!;

            const dataState = get(dataStore);

            if (dataState.status !== "pending") {
                const isLastItem = i === stack.length - 1;

                // We only care about the latest resolved promise. Throw away all earlier
                // stores so they can be garbage collected. We will never need to use them
                // again. Once `PromiseState` is not pending, it will never enter a pending
                // state again.
                stack = stack.slice(i);

                if (dataState.status === "rejected") {
                    throw dataState.reason;
                } else {
                    return {
                        isLoading: false,
                        // If this is not our last store, then we're loading new data. So
                        // make sure to let the user know we're validating.
                        isValidating: !isLastItem,
                        data: dataState.value,
                    };
                }
            }

            if (i === 0) {
                return pendingSwrCacheEntryResult;
            }
        }

        throw new InternalError("Stack should be non-empty");
    });

    return Object.assign(store, {
        lastDedupingIntervalExpirationTime,
        push,
    });
}

/**
 * Returns the result of the last loaded `SwrCacheEntryStack`. With a history
 * stack, we can keep returning previous data while new data is loading.
 *
 * Used to implement `keepPreviousData: true`.
 */
type SwrCacheEntryHistoryStack = Store<SwrCacheEntryResult> & {
    /**
     * The key passed with the last `SwrCacheEntryStack` pushed to our history
     * stack.
     */
    readonly lastKey: string;

    /**
     * Add a new `SwrCacheEntryStack` to our history stack. Once the data within
     * `SwrCacheEntryStack` finishes loading we will present it to the user. Until
     * then we present previously loaded data.
     */
    push(item: {
        key: string;
        entryStackStore: Store<SwrCacheEntryStack | undefined>;
    }): SwrCacheEntryHistoryStack;
};

function createSwrCacheEntryHistoryStack(
    stack: ReadonlyArray<{key: string; entryStackStore: Store<SwrCacheEntryStack | undefined>}>,
): SwrCacheEntryHistoryStack {
    assert(stack.length > 0, "Stack should be non-empty");
    const {key: lastKey} = stack[stack.length - 1]!;

    const push = (item: {
        key: string;
        entryStackStore: Store<SwrCacheEntryStack | undefined>;
    }): SwrCacheEntryHistoryStack => {
        return createSwrCacheEntryHistoryStack([...stack, item]);
    };

    const store = computeStore((get): SwrCacheEntryResult => {
        for (let i = stack.length - 1; i >= 0; i--) {
            const {entryStackStore} = stack[i]!;

            const entryStack = get(entryStackStore);
            const entryResult = entryStack ? get(entryStack) : null;

            if (entryResult && !entryResult.isLoading) {
                const isLastItem = i === stack.length - 1;

                // We only care about the latest resolved promise. Throw away all earlier
                // stores so they can be garbage collected. We will never need to use them
                // again. Once `PromiseState` is not pending, it will never enter a pending
                // state again.
                stack = stack.slice(i);

                if (isLastItem) {
                    return entryResult;
                } else {
                    return {
                        // If this is not our last store, then we're loading new data. So
                        // make sure to let the user know we're validating.
                        isLoading: true,
                        isValidating: entryResult.isValidating,
                        data: entryResult.data,
                    };
                }
            }

            if (i === 0) {
                return pendingSwrCacheEntryResult;
            }
        }

        throw new InternalError("Stack should be non-empty");
    });

    return Object.assign(store, {lastKey, push});
}

const SwrCacheContext = createGlobalContext(() => new SwrCache());

/**
 * A complete re-implementation of the [SWR library][1]. The SWR library has a
 * great API for client side read requests but it's overly complicated. It has
 * too many options and a confusing implementation that doesn't always do
 * precisely what we want. Furthermore we keep finding "bugs" or behaviors
 * that don't exactly match how we think of the library. So we rewrote to
 * simplify, make sure behavior is well defined, and allow for easy
 * modification in the future.
 *
 * Before 2023-12-29 we used the SWR library directly. This is designed to be a
 * drop-in replacement. API names and options match what SWR defines. There are
 * some breaking changes in our implementation.
 *
 * The name "SWR" is derived from `stale-while-revalidate`, a HTTP cache
 * invalidation strategy popularized by [HTTP RFC 5861][2]. SWR is a strategy
 * to first return the data from cache (stale), then send the fetch request
 * (revalidate), and finally come with the up-to-date data.
 *
 * At a high level, we have a cache shared across the entire app. Multiple
 * calls to `useSwr()` will share the same result for the same `key` string. If
 * we have data in the cache for the provided `key` then we'll return that
 * while loading new data in the background so the user sees something.
 *
 * If `isLoading` is true that means we have no cached `data` and we're loading
 * more in the background. If we have `data` but `isValidating` is true then
 * that means we're presenting stale data to the user while fetching new data.
 *
 * [1]: https://swr.vercel.app
 * [2]: https://datatracker.ietf.org/doc/html/rfc5861
 */
export function useSwr(
    key: string | null,
    fetcher: (key: string) => PromiseLike<object>,
    {
        keepPreviousData = false,
        dedupingInterval = 2 * 1000,
    }: {
        /**
         * By default, when the key changes we throw away old data from the last key.
         * However, often you can create a better user experience by showing the user
         * data from the last key while you fetch data for the new key.
         *
         * To continue returning data from the last key while fetching new data set
         * `keepPreviousData: true`.
         */
        keepPreviousData?: boolean;

        /**
         * When we make a request for a given `key`, how long should we consider the
         * request "fresh". Any other component that wants data for the key will reuse
         * the existing pending request instead of sending a new one.
         */
        dedupingInterval?: number;
    } = {},
): SwrCacheEntryResult {
    const cache = useGlobalContext(SwrCacheContext);

    const entryStackStore = key !== null ? cache.getEntryStack(key) : undefinedStore;
    const entryStack = useStore(entryStackStore) ?? null;

    useEffect(() => {
        if (key === null) return;

        cache.retainEntry(key);
        return () => {
            cache.releaseEntry(key);
        };
    }, [cache, key]);

    // When `key` changes, revalidate it once.
    const hasRevalidatedKeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (hasRevalidatedKeyRef.current === key) return;
        hasRevalidatedKeyRef.current = key;

        if (key === null) return;

        cache.revalidateEntry(key, fetcher, {dedupingInterval});
    }, [cache, dedupingInterval, fetcher, key]);

    // Revalidate whenever the browser activates (e.g. the window was hidden then
    // made visible again).
    useEffect(() => {
        if (key === null) return;

        return cache.subscribeToBrowserActivated(() => {
            cache.revalidateEntry(key, fetcher, {dedupingInterval});
        });
    }, [cache, dedupingInterval, fetcher, key]);

    const [originalHistoryStack, setHistoryStack] = useState<SwrCacheEntryHistoryStack | null>(() =>
        keepPreviousData && key !== null
            ? createSwrCacheEntryHistoryStack([{key, entryStackStore}])
            : null,
    );
    let historyStack = originalHistoryStack;

    if (!keepPreviousData && originalHistoryStack !== null) {
        historyStack = null;
        setHistoryStack(historyStack);
    }

    if (keepPreviousData) {
        if (key === null) {
            if (historyStack !== null) {
                historyStack = null;
                setHistoryStack(historyStack);
            }
        } else if (historyStack === null) {
            historyStack = createSwrCacheEntryHistoryStack([{key, entryStackStore}]);
            setHistoryStack(historyStack);
        } else if (historyStack.lastKey !== key) {
            historyStack = historyStack.push({key, entryStackStore});
            setHistoryStack(historyStack);
        }
    }

    // If `keepPreviousData` is true then `historyStack` may be set which may
    // contain data from previous `key`s this hook has seen.
    const entryResult =
        useStore(historyStack ?? entryStack) ??
        (key === null ? disabledSwrCacheEntryResult : pendingSwrCacheEntryResult);

    return entryResult;
}

let scheduledIdlePreloadRpcCallbacks: Array<() => void> | null = null;

/**
 * Preload data into our SWR cache with idle priority. Useful if you have some
 * UI that uses `useSwr()` to render data and you want the data to be
 * immediately available when the user navigates to that UI.
 */
export function useIdlyPreloadSwr(
    key: string | null,
    fetcher: (key: string) => PromiseLike<object>,
    {
        dedupingInterval = 2 * 1000,
    }: {
        dedupingInterval?: number;
    } = {},
) {
    const cache = useGlobalContext(SwrCacheContext);

    const retainedKeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (key === null) return;

        retainedKeyRef.current = key;
        cache.retainEntry(key);
        return () => {
            retainedKeyRef.current = null;
            cache.releaseEntry(key);
        };
    }, [cache, key]);

    // When `key` changes, preload it once.
    const hasPreloadedKeyRef = useRef<string | null>(null);
    useEffect(() => {
        if (hasPreloadedKeyRef.current === key) return;
        hasPreloadedKeyRef.current = key;

        if (key === null) return;

        if (scheduledIdlePreloadRpcCallbacks === null) {
            scheduledIdlePreloadRpcCallbacks = [];

            // Use the React scheduler to schedule an idle callback.
            // `requestIdleCallback()` is not implemented in Safari. Generally we recommend
            // using the React scheduler since it has centralized knowledge of all our
            // tasks (including UI rendering).
            unstable_scheduleCallback(unstable_IdlePriority, () => {
                assert(scheduledIdlePreloadRpcCallbacks !== null);

                const callbacks = scheduledIdlePreloadRpcCallbacks;
                scheduledIdlePreloadRpcCallbacks = null;

                for (const callback of callbacks) {
                    callback();
                }
            });
        }

        assert(retainedKeyRef.current === key);

        scheduledIdlePreloadRpcCallbacks.push(() => {
            // Make sure `key` is still retained. If `key` changes or the component
            // unmounts after we scheduled the idle callback then we need to not run our
            // idle callback.
            if (retainedKeyRef.current === key) {
                cache.revalidateEntryIfNotAvailable(key, fetcher, {dedupingInterval});
            }
        });
    }, [cache, dedupingInterval, fetcher, key]);
}
