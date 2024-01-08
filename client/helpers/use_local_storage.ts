import {useCallback, useEffect, useRef} from "react";
import {useStateWithDependencies} from "~/client/helpers/lifecycle/use_state_with_dependencies.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Use some data saved to [local storage][1]. Keeps our component up-to-date as
 * the data changes. Also makes sure when the local storage in our tab changes,
 * all other tabs that use the data are updated with a [broadcast channel][2].
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
    defaultValue: Value,
): [Value, (value: Value) => void] {
    const [value, actuallySetValue] = useStateWithDependencies(defaultValue, [key, schema]);
    const broadcastChannelRef = useRef<BroadcastChannel | null>(null);

    const reloadFromLocalStorage = useCallback(() => {
        const newValueString = localStorage.getItem(key);
        const newValue =
            newValueString !== null ? schema.deserialize(JSON.parse(newValueString)) : defaultValue;

        actuallySetValue(oldValue => {
            if (isDeepEqual(schema.serialize(oldValue), schema.serialize(newValue))) {
                return oldValue;
            }
            return newValue;
        });
    }, [actuallySetValue, defaultValue, key, schema]);

    useEffect(() => {
        const broadcastChannel = new BroadcastChannel(key);

        const handleMessage = () => {
            reloadFromLocalStorage();
        };

        broadcastChannelRef.current = broadcastChannel;
        broadcastChannel.addEventListener("message", handleMessage);

        // Load any changes we missed while our `BroadcastChannel` was offline.
        reloadFromLocalStorage();

        return () => {
            broadcastChannelRef.current = null;
            broadcastChannel.removeEventListener("message", handleMessage);
            broadcastChannel.close();
        };
    }, [key, reloadFromLocalStorage]);

    const setValue = (newValue: Value) => {
        const serializedNewValue = schema.serialize(newValue);

        localStorage.setItem(key, JSON.stringify(serializedNewValue));

        if (broadcastChannelRef.current) {
            broadcastChannelRef.current.postMessage({});
        } else {
            // If our broadcast channel hasn't initialized yet, create a temporary
            // one here.
            const broadcastChannel = new BroadcastChannel(key);
            broadcastChannel.postMessage({});
            broadcastChannel.close();
        }

        actuallySetValue(oldValue => {
            if (isDeepEqual(schema.serialize(oldValue), serializedNewValue)) {
                return oldValue;
            }
            return newValue;
        });
    };

    return [value, setValue];
}
