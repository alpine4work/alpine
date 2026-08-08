import {Memo, useSyncExternalStore} from "react";
import {noop} from "~/shared/helpers/control/noop.open_source.js";
import {Store} from "~/shared/store/store.js";

/**
 * Convenience hook that directly calls [`useSyncExternalStore()`][1] for using the
 * value from `Store` and keeping it up-to-date over time.
 *
 * [1]: https://react.dev/reference/react/useSyncExternalStore
 */
export function useStore<Value>(store: Store<Value>): Memo<Value>;
export function useStore<Value>(store: Store<Value> | null): Memo<Value> | null;
export function useStore<Value>(store: Store<Value> | null): Memo<Value> | null {
    return useSyncExternalStore(
        store?.subscribe ?? subscribeToNull,
        store?.getSnapshot ?? getNullSnapshot,
        store?.getSnapshot ?? getNullSnapshot,
    ) as Memo<Value> | null;
}

function subscribeToNull() {
    return noop;
}

function getNullSnapshot() {
    return null;
}
