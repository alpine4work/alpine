import {useCallback, useEffect, useMemo, useRef, useState} from "react";
import {useAsyncIterable} from "~/client/helpers/async/use-async-iterable";
import {useStableJsonValue} from "~/client/helpers/memo/use-stable-json-value";
import {
    AblyRealtimeClientPresenceSession,
    ablyRealtimeClient,
} from "~/client/network/internal/ably-realtime-client";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run-promise-without-awaiting";
import {BlockInference} from "~/shared/helpers/types/block-inference";
import {getAblyChannelNameForNetworkChannel} from "~/shared/network/helpers/get-ably-channel-name-for-network-channel";
import {NetworkPresenceChannel} from "~/shared/network/network-presence-channel";
import {SchemaSerializedValue} from "~/shared/schema/schema";

export type NetworkPresenceStateEntry<State> = {
    readonly clientId: string;
    readonly connectionId: string;
    readonly state: State;
};

/**
 * This hook sends presence state for our client to other clients and returns
 * the presence state for every other client.
 *
 * Important: Presence state is not server validated! That means bad actor
 * clients can publish whatever state they want to our presence channel.
 * Perform your own validations on the client before using states from other
 * clients for anything that is critical to get right.
 */
export function useNetworkPresenceChannel<Key extends {[key: string]: string}, State>(
    channel: NetworkPresenceChannel<Key, State>,
    unstableKey: BlockInference<Key>,
    unstableState: BlockInference<State>,
): Iterable<NetworkPresenceStateEntry<State>> {
    const unstableSerializedState = useMemo(
        () => channel.stateSchema.serialize(unstableState as State),
        [channel.stateSchema, unstableState],
    );

    const key = useStableJsonValue(unstableKey);
    const serializedState = useStableJsonValue(unstableSerializedState);

    // For accessing the current state without taking a dependency on the
    // state object.
    const serializedStateRef = useRef(serializedState);
    useEffect(() => {
        serializedStateRef.current = serializedState;
    });

    const [errorState, setErrorState] = useState<
        {hasError: false} | {hasError: true; error: unknown}
    >({hasError: false});

    // Throw when our subscription has an error so the user sees it. We may want to
    // give developers the ability to customize this behavior by showing an inline
    // retry button.
    if (errorState.hasError) throw errorState.error;

    const [presenceSessionState, setPresenceSessionState] = useState<{
        currentSerializedState: SchemaSerializedValue;
        readonly promise: Promise<AblyRealtimeClientPresenceSession>;
    } | null>(null);

    // Start a new presence session whenever the channel key changes.
    useEffect(() => {
        const channelName = getAblyChannelNameForNetworkChannel(channel, key);

        const currentSerializedState = serializedStateRef.current;

        const presenceSessionPromise = ablyRealtimeClient.enterWithPresenceState(
            channelName,
            currentSerializedState,
        );

        presenceSessionPromise.catch(error => setErrorState({hasError: true, error}));

        setPresenceSessionState({
            currentSerializedState,
            promise: presenceSessionPromise,
        });

        return () => {
            runPromiseWithoutAwaiting(async () => {
                try {
                    let presenceSession;
                    try {
                        presenceSession = await presenceSessionPromise;
                    } catch {
                        // Presence session state promise errors should have already been handled.
                        // If we see the same error here then noop the rest of this promise.
                        return;
                    }

                    await presenceSession.leave();
                } catch (error) {
                    setErrorState({hasError: true, error});
                }
            });
        };
    }, [channel, key]);

    // Whenever we get a new `serializedState` we want an effect to run that
    // updates our presence session state.
    useEffect(() => {
        if (!presenceSessionState) return;

        let isCancelled = false;

        runPromiseWithoutAwaiting(async () => {
            try {
                let presenceSession;
                try {
                    presenceSession = await presenceSessionState.promise;
                } catch {
                    // Presence session state promise errors should have already been handled.
                    // If we see the same error here then noop the rest of this promise.
                    return;
                }

                if (isCancelled) return;

                // When we enter the presence session we will enter with the current state.
                // This effect will run after we enter so don't update with the same state we
                // entered with.
                if (presenceSessionState.currentSerializedState !== serializedState) {
                    presenceSessionState.currentSerializedState = serializedState;
                    await presenceSession.update(serializedState);
                }
            } catch (error) {
                setErrorState({hasError: true, error});
            }
        });

        return () => {
            isCancelled = true;
        };
    }, [presenceSessionState, serializedState]);

    const [presenceStates, setPresenceStates] = useState<
        Iterable<NetworkPresenceStateEntry<State>>
    >([]);

    useAsyncIterable({
        iterable: useCallback(
            ({signal}) => {
                const channelName = getAblyChannelNameForNetworkChannel(channel, key);
                return ablyRealtimeClient.subscribeToPresenceStates(channelName, {signal});
            },
            [channel, key],
        ),
        next: states => {
            setPresenceStates({
                [Symbol.iterator]: function* (): IterableIterator<
                    NetworkPresenceStateEntry<State>
                > {
                    for (const [connectionKey, serializedState] of states) {
                        const [clientId = "", connectionId = ""] = connectionKey.split(":", 2);

                        // We don't reclassify `SchemaDeserializationError` to `InternalError` here
                        // because presence states aren't validated by the server. So an untrusted
                        // client could send whatever it wants. This means most of the time a
                        // deserialization error is an internal error but in the rare case of a
                        // malicious actor, it is not.
                        const state = channel.stateSchema.deserialize(serializedState);

                        yield {clientId, connectionId, state};
                    }
                },
            });
        },
        error: error => setErrorState({hasError: true, error}),
    });

    return presenceStates;
}
