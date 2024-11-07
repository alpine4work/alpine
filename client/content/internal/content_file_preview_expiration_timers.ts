import {createGlobalContext, useGlobalContext} from "~/client/helpers/global_context.js";
import {getContentReferencesFileSignedUrlSearchExpirationTime} from "~/shared/content/content_references.js";
import {Timeout, createTimeout} from "~/shared/helpers/async/timeout.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {falseStore, trueStore} from "~/shared/store/const_store.js";
import {Store} from "~/shared/store/store.js";
import {ValueStore} from "~/shared/store/value_store.js";

const contentFileSignedUrlEagerExpirationDurationMs = 1000 * 20;
const contentFileSignedUrlRefreshDurationMs =
    contentFileSignedUrlEagerExpirationDurationMs + 1000 * 20;

const ContentFilePreviewExpirationTimersContext = createGlobalContext(
    () => new ContentFilePreviewExpirationTimers(),
);

export function useContentFilePreviewExpirationTimers() {
    return useGlobalContext(ContentFilePreviewExpirationTimersContext);
}

export class ContentFilePreviewExpirationTimers {
    private _retainCount = 0;
    private readonly _storeByTime = new Map<
        number,
        {timeout: Timeout | null; readonly store: ValueStore<boolean>}
    >();

    /**
     * When this object is fully released we'll pause all associated timers. Any
     * stores that are currently false (e.g. `getExpiredTimerStore()`) won't be
     * updated to true while this object is released since all timeouts have been
     * cancelled. If you call `play()` all timers will be re-scheduled.
     *
     * You should call this function when your component that renders file previews
     * unmounts in order to prevent memory leaks. Otherwise we'll keep accumulating
     * hour long timers that are never cancelled even if the user doesn't care
     * about them anymore.
     */
    public release(): void {
        assert(this._retainCount > 0);
        this._retainCount--;
        const isRetained = this._retainCount > 0;

        if (!isRetained) {
            for (const entry of this._storeByTime.values()) {
                entry.timeout?.clear();
                entry.timeout = null;
            }
        }
    }

    /**
     * While this object is retained we'll run its timers. When the object is fully
     * released we'll pause all timers. We should only retain this object on the
     * client.
     *
     * If any timers should have been fired after the object was released then
     * we'll fire those timers basically immediately after the next `retain()`
     * call.
     *
     * This object starts in a released state so you must call `retain()` to start
     * registering timers.
     */
    public retain(): void {
        assert(typeof window !== "undefined");

        const wasRetained = this._retainCount > 0;
        this._retainCount++;

        if (!wasRetained) {
            for (const [time, entry] of this._storeByTime) {
                if (!entry.store.getSnapshot()) {
                    entry.timeout ??= createTimeout(() => {
                        entry.store.finalSet(true);

                        // New signed URLs shouldn't have this expiration time. Delete from our map to
                        // prevent memory leaks.
                        this._storeByTime.delete(time);
                    }, Math.max(0, time - Date.now()));
                }
            }
        }
    }

    /**
     * Return a store which will switch to true ~20-30 seconds before the preview
     * URL actually expires. Generally returns return the same referentially equal
     * store for the same expiration time in the preview URL.
     */
    public getExpiredTimerStore(signedUrlSearch: string): Store<boolean> {
        // If we're on the server then always return false so we don't create
        // unnecessary timers on the server. This shouldn't realistically create issues
        // with SSR hydration since signed URLs should be generated at the start of an
        // SSR request and last much much longer (e.g. 1 hour) than an SSR request
        // should reasonably take (e.g. 1 second).
        if (typeof window === "undefined") return falseStore;

        const expirationTime =
            getContentReferencesFileSignedUrlSearchExpirationTime(signedUrlSearch);

        // Round to the nearest 10 seconds so we end up creating fewer stores.
        const roundedExpirationTime = Math.floor(expirationTime / (1000 * 10)) * (1000 * 10);

        const eagerExpirationTime =
            roundedExpirationTime - contentFileSignedUrlEagerExpirationDurationMs;

        return this._getStore(eagerExpirationTime);
    }

    /**
     * Return a store which will switch to true ~40-50 seconds before the preview
     * URL expires. Generally returns the same referentially equal store for the
     * same expiration time in the preview URL.
     */
    public getRefreshTimerStore(signedUrlSearch: string): Store<boolean> {
        // If we're on the server then always return false so we don't create
        // unnecessary timers on the server. This shouldn't realistically create issues
        // with SSR hydration since signed URLs should be generated at the start of an
        // SSR request and last much much longer (e.g. 1 hour) than an SSR request
        // should reasonably take (e.g. 1 second).
        if (typeof window === "undefined") return falseStore;

        const expirationTime =
            getContentReferencesFileSignedUrlSearchExpirationTime(signedUrlSearch);

        // Round to the nearest 10 seconds so we end up creating fewer stores.
        const roundedExpirationTime = Math.floor(expirationTime / (1000 * 10)) * (1000 * 10);

        const refreshTime = roundedExpirationTime - contentFileSignedUrlRefreshDurationMs;

        return this._getStore(refreshTime);
    }

    private _getStore(time: number) {
        // Make sure this isn't run on the server since we don't want to register a
        // bunch of unnecessary timeouts. The `typeof window === "undefined"`
        // check should handle this so this assertion is an extra precaution.
        assert(typeof window !== "undefined");

        const durationMsUntilTime = time - Date.now();
        if (durationMsUntilTime <= 0) return trueStore;

        return getOrSetDefaultMapValue(this._storeByTime, time, () => {
            const store = new ValueStore(false);

            const timeout =
                this._retainCount > 0
                    ? createTimeout(() => {
                          store.finalSet(true);

                          // New signed URLs shouldn't have this expiration time. Delete from our map to
                          // prevent memory leaks.
                          this._storeByTime.delete(time);
                      }, durationMsUntilTime)
                    : null;

            return {timeout, store};
        }).store;
    }
}
