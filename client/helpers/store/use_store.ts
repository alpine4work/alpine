import {useSyncExternalStore} from "react";
import {Store} from "~/client/helpers/store/store";

/**
 * Convenience hook that directly calls [`useSyncExternalStore()`][1] for using
 * the value from `Store` and keeping it up-to-date over time.
 *
 * [1]: https://react.dev/reference/react/useSyncExternalStore
 */
export function useStore<Value>(store: Store<Value>): Value;
export function useStore<Value>(store: Store<Value> | null): Value | null;
export function useStore<Value>(store: Store<Value> | null): Value | null {
    return useSyncExternalStore(
        store?.subscribe ?? subscribeToNull,
        store?.getSnapshot ?? getNullSnapshot,
        store?.getSnapshot ?? getNullSnapshot,
    );
}

function subscribeToNull() {
    return () => {};
}

function getNullSnapshot() {
    return null;
}
