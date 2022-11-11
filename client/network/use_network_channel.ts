import {useCallback, useState} from "react";
import {useAsyncIterable} from "~/client/helpers/async/use_async_iterable";
import {useStableJsonValue} from "~/client/helpers/memo/use_stable_json_value";
import {subscribeToNetworkChannel} from "~/client/network/subscribe_to_network_channel";
import {BlockInference} from "~/shared/helpers/types/block_inference";
import {NetworkChannel} from "~/shared/network/network_channel";

/**
 * Hook for subscribing to messages in the provided `NetworkChannel` using
 * `subscribeToNetworkChannel()`.
 *
 * Whenever we get a new message the listener is called.
 */
export function useNetworkChannel<
    Key extends {[key: string]: string},
    Message extends {type: string},
>(
    channel: NetworkChannel<Key, Message>,
    unstableKey: BlockInference<Key>,
    listener: (message: Message) => void,
) {
    const key = useStableJsonValue(unstableKey);

    const [errorState, setErrorState] = useState<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    // Throw when our subscription has an error so the user sees it. We may want to
    // give developers the ability to customize this behavior by showing an inline
    // retry button.
    if (errorState.hasError) throw errorState.error;

    useAsyncIterable({
        iterable: useCallback(
            ({signal}) => subscribeToNetworkChannel(channel, key, {signal}),
            [channel, key],
        ),
        next: listener,
        error: error => setErrorState({hasError: true, error}),
    });
}
