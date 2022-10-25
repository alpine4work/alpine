import {useEffect, useRef, useState} from "react";
import {useStableJsonValue} from "~/client/helpers/lifecycle/use-stable-json-value";
import {subscribeToNetworkChannel} from "~/client/network/subscribe-to-network-channel";
import {CancelledError} from "~/shared/error/error";
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
    networkChannel: NetworkChannel<Key, Message>,
    unstableKey: BlockInference<Key>,
    listener: (message: Message) => void,
) {
    const key = useStableJsonValue(unstableKey);

    const listenerRef = useRef(listener);
    useEffect(() => {
        listenerRef.current = listener;
    });

    const [errorState, setErrorState] = useState<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    // Throw when our subscription has an error so the user sees it. We may want to
    // give developers the ability to customize this behavior by showing an inline
    // retry button.
    if (errorState.hasError) throw errorState.error;

    useEffect(() => {
        const abortController = new AbortController();

        const iterator = subscribeToNetworkChannel(networkChannel, key, {
            signal: abortController.signal,
        });

        let isCancelled = false;
        const cancelError = new CancelledError("Unsubscribed from network channel");
        const cancel = () => abortController.abort(cancelError);

        const loop = () => {
            if (isCancelled) return;

            iterator.next().then(
                result => {
                    if (isCancelled || result.done) return;

                    // Call our listener. The listener is in a ref so our effect does not need a
                    // dependency on the listener function.
                    listenerRef.current(result.value);

                    loop();
                },
                error => {
                    // If this is the error from our `AbortSignal` then we can ignore it since
                    // it's expected.
                    if (error === cancelError) return;

                    setErrorState({hasError: true, error});
                },
            );
        };

        loop();

        return () => {
            isCancelled = true;
            cancel();
        };
    }, [key, networkChannel]);
}
