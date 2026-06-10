import {useCallback, useEffect, useRef, useState} from "react";
import {useIsInitialAppRender} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {useStateWithDependencies} from "~/client/web/helpers/lifecycle/use_state_with_dependencies.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Use some data saved to [local storage][1]. Keeps our component up-to-date as the
 * data changes. Also makes sure when the local storage in our tab changes, all
 * other tabs that use the data are updated with a [broadcast channel][2].
 *
 * We recommend starting all keys with `cyberworlds/` since `localStorage` keys
 * live in a global namespace.
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/API/Window/localStorage
 * [2]: https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API
 */
export function useLocalStorage<Value>(
    key: string,
    schema: Schema<Value>,
    defaultValue: Value | (() => Value),
): [value: Value, setValue: (value: Value) => void, isLoading: boolean] {
    return useStorageBase(
        typeof window !== "undefined" ? localStorage : null,
        key,
        schema,
        defaultValue,
    );
}

/**
 * Deletes our state for the provided key. Any components listening for this key
 * will be re-rendered.
 *
 * Prefer this to directly calling `localStorage.deleteItem()` because this will
 * automatically re-render any components which depend on the state.
 */
export function removeLocalStorage(key: string) {
    assert(typeof window !== "undefined");
    removeStorageBase(localStorage, key);
}

/**
 * Use some data saved to [session storage][1]. Keeps our component up-to-date as
 * the data changes. Other tabs don't typically share the same session storage, but
 * in case they do we'll keep date in other tabs updated with a [broadcast
 * channel][2].
 *
 * We recommend starting all keys with `cyberworlds/` since `sessionStorage` keys
 * live in a global namespace.
 *
 * [1]: https://developer.mozilla.org/en-US/docs/Web/API/Window/sessionStorage
 * [2]: https://developer.mozilla.org/en-US/docs/Web/API/Broadcast_Channel_API
 */
export function useSessionStorage<Value>(
    key: string,
    schema: Schema<Value>,
    defaultValue: Value | (() => Value),
): [value: Value, setValue: (value: Value) => void, isLoading: boolean] {
    return useStorageBase(
        typeof window !== "undefined" ? sessionStorage : null,
        key,
        schema,
        defaultValue,
    );
}

/**
 * Deletes our state for the provided key. Any components listening for this key
 * will be re-rendered.
 *
 * Prefer this to directly calling `sessionStorage.deleteItem()` because this will
 * automatically re-render any components which depend on the state.
 */
export function removeSessionStorage(key: string) {
    assert(typeof window !== "undefined");
    removeStorageBase(sessionStorage, key);
}

function useStorageBase<Value>(
    storage: Storage | null,
    key: string,
    schema: Schema<Value>,
    defaultValue: Value | (() => Value),
): [value: Value, setValue: (value: Value) => void, isLoading: boolean] {
    const isInitialAppRender = useIsInitialAppRender();

    const [value, actuallySetValue] = useStateWithDependencies((): Value => {
        // During SSR we need to use the default value since `localStorage` isn't available
        // on the server. After that for client navigations we can use the value in
        // `localStorage`.
        if (isInitialAppRender) {
            return typeof defaultValue === "function" ? (defaultValue as any)() : defaultValue;
        } else {
            assert(typeof window !== "undefined");

            const initialValueString = assertExists(storage).getItem(key) ?? null;
            const initialValue: Value =
                initialValueString !== null
                    ? schema.deserialize(JSON.parse(initialValueString))
                    : typeof defaultValue === "function"
                      ? (defaultValue as any)()
                      : defaultValue;

            return initialValue;
        }
    }, [key, schema]);
    const [isLoading, setIsLoading] = useState(true);
    const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

    const reloadFromStorage = useCallback(() => {
        assert(typeof window !== "undefined");

        const newValueString = assertExists(storage).getItem(key) ?? null;
        const newValue: Value =
            newValueString !== null
                ? schema.deserialize(JSON.parse(newValueString))
                : typeof defaultValue === "function"
                  ? (defaultValue as any)()
                  : defaultValue;

        actuallySetValue(oldValue => {
            if (isDeepEqual(schema.serialize(oldValue), schema.serialize(newValue))) {
                return oldValue;
            }
            return newValue;
        });
    }, [actuallySetValue, defaultValue, key, schema, storage]);

    useEffect(() => {
        const broadcastChannel = new BroadcastChannel(key);

        const handleMessage = () => {
            reloadFromStorage();
        };

        broadcastChannelRef.current = broadcastChannel;
        broadcastChannel.addEventListener("message", handleMessage);

        // Load any changes we missed while our `BroadcastChannel` was offline.
        reloadFromStorage();

        // While waiting for the initial value to load from storage `isLoading` is true.
        // Then once we get the first value it's updated to false.
        setIsLoading(false);

        return () => {
            broadcastChannelRef.current = null;
            broadcastChannel.removeEventListener("message", handleMessage);
            broadcastChannel.close();
        };
    }, [key, reloadFromStorage]);

    const setValue = (newValue: Value) => {
        const serializedNewValue = schema.serialize(newValue);

        storage?.setItem(key, JSON.stringify(serializedNewValue));

        if (broadcastChannelRef.current) {
            broadcastChannelRef.current.postMessage({});
        } else {
            // If our broadcast channel hasn't initialized yet, create a temporary one here.
            const broadcastChannel = new BroadcastChannel(key);
            broadcastChannel.postMessage({});
            broadcastChannel.close();
        }

        actuallySetValue(newValue);
    };

    return [value, setValue, isLoading];
}

function removeStorageBase(storage: Storage, key: string) {
    storage.removeItem(key);

    // Update all hooks depending on this key.
    const broadcastChannel = new BroadcastChannel(key);
    broadcastChannel.postMessage({});
    broadcastChannel.close();
}
