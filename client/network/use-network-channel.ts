import {useCallback, useState} from "react";
import {useAsyncIterable} from "~/client/helpers/async/use-async-iterable";
import {useStableJsonValue} from "~/client/helpers/memo/use-stable-json-value";
import {subscribeToNetworkChannel} from "~/client/network/subscribe-to-network-channel";
import {BlockInference} from "~/shared/helpers/types/block-inference";
import {NetworkChannel} from "~/shared/network/network-channel";

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
