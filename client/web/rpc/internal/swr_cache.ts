import {createGlobalContext} from "~/client/web/helpers/global_context.js";
import {FailedPreconditionError, InternalError} from "~/shared/error/error.js";
import {emptyArray} from "~/shared/helpers/array/empty_array.js";
import {PromiseState} from "~/shared/helpers/async/promise_state.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {EventEmitter} from "~/shared/helpers/control/event_emitter.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {SafeFloatingPromiseLike} from "~/shared/helpers/types/safe_floating_promise.js";
import {computeStore} from "~/shared/store/compute_store.js";
import {createPromiseStore} from "~/shared/store/promise_store.js";
import {Store} from "~/shared/store/store.js";
import {StoreMap} from "~/shared/store/store_map.js";
import {ValueStore} from "~/shared/store/value_store.js";

export const swrDefaultDedupingIntervalMs = 2 * 1000;

/**
 * Amount of time we wait before expiring an entry from the SWR cache. This may be
 * observed by a user if they quickly switch between states as they won't have to
 * wait for network requests.
 *
 * This should probably be configurable. We can throwaway combobox search results
 * faster than affinitive search entity lists.
 */
const swrCacheEntryExpirationDurationMs = 20 * 1000;

/**
 * Cache for SWR data shared across our React app.
 */
export class SwrCache {
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

    private readonly _optimisticUpdatesStoreByKey = new Map<
        string,
        ValueStore<
            ReadonlyArray<{
                readonly promise: Promise<unknown>;
                readonly update: (value: object) => object;
            }>
        >
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

    public destroy(): void {
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

    private _onBrowserStateChange(): void {
        const wasBrowserActive = this._isBrowserActive;
        this._isBrowserActive = this._isOnline && document.visibilityState === "visible";

        if (!wasBrowserActive && this._isBrowserActive) {
            this._browserActivatedEmitter.emit();
        }
    }

    public subscribeToBrowserActivated(listener: () => void): () => void {
        return this._browserActivatedEmitter.subscribe(listener);
    }

    /**
     * Get the cache entry associated with this key.
     */
    public getEntryStack(key: string): Store<SwrCacheEntryStack | undefined> {
        return this._entryStackByKey.get(key);
    }

    /**
     * Retain cached data for the provided key. Multiple components may retain the same
     * data. We won't delete the data from the cache until the entry is fully released.
     */
    public retainEntry(key: string): void {
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
     * Release cached data for the provided key. Once the entry has been fully released
     * we delete the data after our expiration timeout from the cache so it can be
     * garbage collected.
     */
    public releaseEntry(key: string): void {
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
     * Revalidate an entry with the provided fetcher function. May not revalidate if
     * the entry was previously validated and we're within the `dedupingInterval` of
     * that previous validation.
     */
    public revalidateEntry(
        key: string,
        fetcher: (key: string) => PromiseLike<object>,
        options?: {dedupingInterval?: number},
    ): void {
        const referenceState = this._referenceStateByKey.get(key);
        if (!((referenceState?.referenceCount ?? 0) > 0)) {
            throw new FailedPreconditionError("Must retain entry before it can be revalidated");
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
     * Revalidate an entry with the provided fetcher function but only if the entry has
     * not yet been initialized in the cache. If the entry is available in our cache do
     * nothing.
     *
     * Useful for preloading. When preloading we only want to make sure an entry is
     * available so we have some data to show later. It's ok if the entry is stale.
     */
    public revalidateEntryIfNotAvailable(
        key: string,
        fetcher: (key: string) => PromiseLike<object>,
        options?: {dedupingInterval?: number},
    ): void {
        const referenceState = this._referenceStateByKey.get(key);
        if (!((referenceState?.referenceCount ?? 0) > 0)) {
            throw new FailedPreconditionError("Must retain entry before it can be revalidated");
        }

        const currentTime = Date.now();
        const entryStack = this._entryStackByKey.getSnapshot(key);

        if (entryStack === undefined) {
            this._forceRevalidateEntry(key, fetcher, options, currentTime, entryStack);
        }
    }

    /**
     * Revalidate an entry with the provided fetcher function. Ignores the previous
     * entry's `dedupingInterval` and forces the entry to be re-fetched.
     */
    public forceRevalidateEntry(
        key: string,
        fetcher: (key: string) => PromiseLike<object>,
        options?: {dedupingInterval?: number},
    ): SafeFloatingPromiseLike<object> {
        const referenceState = this._referenceStateByKey.get(key);
        if (!((referenceState?.referenceCount ?? 0) > 0)) {
            throw new FailedPreconditionError("Must retain entry before it can be revalidated");
        }

        const currentTime = Date.now();
        const entryStack = this._entryStackByKey.getSnapshot(key);

        return this._forceRevalidateEntry(key, fetcher, options, currentTime, entryStack);
    }

    private _forceRevalidateEntry(
        key: string,
        fetcher: (key: string) => PromiseLike<object>,
        {dedupingInterval = swrDefaultDedupingIntervalMs}: {dedupingInterval?: number} = {},
        currentTime: number,
        entryStack: SwrCacheEntryStack | undefined,
    ): SafeFloatingPromiseLike<object> {
        const dedupingIntervalExpirationTime = currentTime + dedupingInterval;
        const dataPromise = fetcher(key);

        const dataStoreWithoutOptimisticUpdates = createPromiseStore(dataPromise);

        const optimisticUpdatesStore = getOrSetDefaultMapValue(
            this._optimisticUpdatesStoreByKey,
            key,
            () =>
                new ValueStore<
                    ReadonlyArray<{
                        readonly promise: Promise<unknown>;
                        readonly update: (value: object) => object;
                    }>
                >(emptyArray),
        );

        const dataStore: Store<PromiseState<object>> = Store.mapMany(
            [dataStoreWithoutOptimisticUpdates, optimisticUpdatesStore],
            ([data, optimisticUpdates]) => {
                if (data.status !== "fulfilled") {
                    return data;
                } else {
                    const newDataValue = optimisticUpdates.reduce(
                        (value, update) => update.update(value),
                        data.value,
                    );

                    // Optimization: If the optimistic updates didn't change the data then we can
                    // return the original data object and skip an update.
                    if (Object.is(newDataValue, data.value)) return data;

                    return {status: "fulfilled", value: newDataValue};
                }
            },
        );

        entryStack =
            entryStack?.push({dedupingIntervalExpirationTime, dataStore}) ??
            createSwrCacheEntryStack([{dedupingIntervalExpirationTime, dataStore}]);

        this._entryStackByKey.set(key, entryStack);

        return dataPromise as SafeFloatingPromiseLike<object>;
    }

    /**
     * Add an optimistic update to the cache for the given key. While the promise is
     * pending, whenever you read the data for this key the optimistic updates will be
     * applied. Once the promise resolves the optimistic updates are reverted and we
     * expect the data in the cache to be correct.
     *
     * This differs from `useStateWithOptimisticUpdates()` which will permanently
     * commit the optimistic update if the promise resolves without error.
     */
    public addOptimisticUpdate(
        key: string,
        promise: Promise<unknown>,
        update: (value: object) => object,
    ) {
        const optimisticUpdate = {
            promise,
            update,
        };

        const optimisticUpdatesStore = getOrSetDefaultMapValue(
            this._optimisticUpdatesStoreByKey,
            key,
            () =>
                new ValueStore<
                    ReadonlyArray<{
                        readonly promise: Promise<unknown>;
                        readonly update: (value: object) => object;
                    }>
                >(emptyArray),
        );

        optimisticUpdatesStore.set(optimisticUpdates => [...optimisticUpdates, optimisticUpdate]);

        const cleanup = () => {
            optimisticUpdatesStore.set(optimisticUpdates =>
                optimisticUpdates.filter(
                    otherOptimisticUpdate => otherOptimisticUpdate !== optimisticUpdate,
                ),
            );
        };

        promise.then(cleanup, cleanup);
    }
}

export type SwrCacheEntryResult = {
    readonly isLoading: boolean;
    readonly isValidating: boolean;
    readonly data: object | null;
};

export const pendingSwrCacheEntryResult: SwrCacheEntryResult = {
    isLoading: true,
    isValidating: true,
    data: null,
};

export const disabledSwrCacheEntryResult: SwrCacheEntryResult = {
    isLoading: false,
    isValidating: true,
    data: null,
};

/**
 * An entry in our SWR cache. A cache entry acts like a stack. We present the last
 * loaded data for this entry even if the entry is revalidating.
 */
export type SwrCacheEntryStack = Store<SwrCacheEntryResult> & {
    /**
     * The time at which a `revalidate()` call must issue a new request and can't reuse
     * the existing data in our entry.
     */
    readonly lastDedupingIntervalExpirationTime: number;

    /**
     * Add a new asynchronous request to our entry. Once the request has resolved we
     * will return its data. Until then we will return the last asynchronous data to be
     * resolved that was pushed to our entry.
     */
    readonly push: (item: {
        dedupingIntervalExpirationTime: number;
        dataStore: Store<PromiseState<object>>;
    }) => SwrCacheEntryStack;
};

export function createSwrCacheEntryStack(
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

                // We only care about the latest resolved promise. Throw away all earlier stores so
                // they can be garbage collected. We will never need to use them again. Once
                // `PromiseState` is not pending, it will never enter a pending state again.
                stack = stack.slice(i);

                if (dataState.status === "rejected") {
                    throw dataState.reason;
                } else {
                    return {
                        isLoading: false,
                        // If this is not our last store, then we're loading new data. So make sure to let
                        // the user know we're validating.
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
export type SwrCacheEntryHistoryStack = Store<SwrCacheEntryResult> & {
    /**
     * The key passed with the last `SwrCacheEntryStack` pushed to our history stack.
     */
    readonly lastKey: string;

    /**
     * Add a new `SwrCacheEntryStack` to our history stack. Once the data within
     * `SwrCacheEntryStack` finishes loading we will present it to the user. Until then
     * we present previously loaded data.
     */
    readonly push: (item: {
        key: string;
        entryStackStore: Store<SwrCacheEntryStack | undefined>;
    }) => SwrCacheEntryHistoryStack;
};

export function createSwrCacheEntryHistoryStack(
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

                // We only care about the latest resolved promise. Throw away all earlier stores so
                // they can be garbage collected. We will never need to use them again. Once
                // `PromiseState` is not pending, it will never enter a pending state again.
                stack = stack.slice(i);

                if (isLastItem) {
                    return entryResult;
                } else {
                    return {
                        // If this is not our last store, then we're loading new data. So make sure to let
                        // the user know we're validating.
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

export const SwrCacheContext = createGlobalContext(() => new SwrCache());
