import {Memo, useCallback, useEffect, useRef, useState} from "react";
import {useAppContext} from "~/client/web/context/app_context.js";
import {
    DynamoGeneralRealtimeEvent,
    DynamoGeneralRealtimeItem,
} from "~/shared/dynamo/dynamo_general_realtime_types.js";
import {DynamoItemKey} from "~/shared/dynamo/dynamo_opaque_strings.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Keep an item from our DynamoDB realtime framework up-to-date on the client.
 *
 * You must have initially loaded the item from somewhere. Probably a server-side
 * render.
 *
 * You must connect to a WebSocket or other push-based realtime service outside of
 * this hook and then pass in relevant `isConnected` and `subscribeToEvents` props
 * to wire up this hook to a WebSocket.
 *
 * If the item is deleted then we'll set an `isDeleted` flag and update the version
 * but we'll keep the old item around to avoid breaking the UI.
 */
export function useDynamoGeneralRealtimeItem<Model>(
    initialItem: DynamoGeneralRealtimeItem<Model>,
    options: {
        /**
         * Are we connected to a WebSocket or other push-based realtime service that will
         * send us events when our item updates? If true then `subscribeToEvents()` should
         * be how we access those realtime events.
         */
        isConnected: boolean;

        /**
         * Subscribe to realtime events that may affect this item. The event source may
         * also be sending events unrelated to our item, this hook will filter out
         * unrelated updates.
         *
         * This hook also correctly handles out-of-order updates. If a past update is
         * delivered late (after a newer update) we will drop it.
         */
        subscribeToEvents: Memo<
            (
                subscriber: (
                    eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<unknown>>,
                ) => void,
            ) => () => void
        >;

        /**
         * We need to reload the item whenever we connect to our realtime service. That's
         * because when connected to our realtime service, we're guaranteed to receive all
         * events for the item that start AFTER we successfully connect. But what if
         * updates happened BEFORE we connect but after we load the initial item that's
         * passed in as a prop? The reload function catches those updates.
         *
         * The reload function also runs if the user temporarily disconnects from internet
         * then reconnects (e.g. they went through a tunnel) to make sure the user doesn't
         * miss any realtime updates.
         *
         * It's important to use strong read consistency in your reload function. Eventual
         * consistency may still miss some updates.
         */
        reloadItemWithStrongReadConsistency: () => Promise<DynamoGeneralRealtimeItem<Model>>;
    },
): {
    item: DynamoGeneralRealtimeItem<Model>;
    handleEventTransaction: Memo<
        (eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<unknown>>) => void
    >;
} {
    const [itemFromState, setItem] = useState<
        DynamoGeneralRealtimeItem<Model> & {readonly isDeleted?: true}
    >(initialItem);
    let item = itemFromState;

    // If the item provided via props is a newer version then use it in our state. Or
    // if it is a different item entirely (by key).
    if (initialItem.key === item.key && initialItem.version > item.version) {
        setItem(initialItem);
        item = initialItem;
    } else if (initialItem.key !== item.key) {
        setItem(initialItem);
        item = initialItem;
    }

    return useDynamoGeneralRealtimeItemBase(
        {item, onUpdateItem: useCallback(update => setItem(update), [])},
        options,
    );
}

/**
 * The same as `useDynamoGeneralRealtimeItem()` but you can bring your own state.
 *
 * If the item is deleted then we'll set an `isDeleted` flag and update the version
 * but we'll keep the old item around to avoid breaking the UI.
 */
export function useDynamoGeneralRealtimeItemBase<Model>(
    {
        item,
        onUpdateItem,
    }: {
        /**
         * The current realtime item.
         */
        item: DynamoGeneralRealtimeItem<Model> & {readonly isDeleted?: true};

        /**
         * Update the realtime item with an updater function that takes as input the
         * current realtime item.
         */
        onUpdateItem: Memo<
            (
                update: (
                    item: DynamoGeneralRealtimeItem<Model>,
                ) => DynamoGeneralRealtimeItem<Model> & {readonly isDeleted?: true},
            ) => void
        >;
    },
    {
        isConnected,
        subscribeToEvents,
        reloadItemWithStrongReadConsistency,
    }: {
        /**
         * Are we connected to a WebSocket or other push-based realtime service that will
         * send us events when our item updates? If true then `subscribeToEvents()` should
         * be how we access those realtime events.
         */
        isConnected: boolean;

        /**
         * Subscribe to realtime events that may affect this item. The event source may
         * also be sending events unrelated to our item, this hook will filter out
         * unrelated updates.
         *
         * This hook also correctly handles out-of-order updates. If a past update is
         * delivered late (after a newer update) we will drop it.
         */
        subscribeToEvents: Memo<
            (
                subscriber: (
                    eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<unknown>>,
                ) => void,
            ) => (() => void) | void
        >;

        /**
         * We need to reload the item whenever we connect to our realtime service. That's
         * because when connected to our realtime service, we're guaranteed to receive all
         * events for the item that start AFTER we successfully connect. But what if
         * updates happened BEFORE we connect but after we load the initial item that's
         * passed in as a prop? The reload function catches those updates.
         *
         * The reload function also runs if the user temporarily disconnects from internet
         * then reconnects (e.g. they went through a tunnel) to make sure the user doesn't
         * miss any realtime updates.
         *
         * It's important to use strong read consistency in your reload function. Eventual
         * consistency may still miss some updates.
         */
        reloadItemWithStrongReadConsistency: () => Promise<DynamoGeneralRealtimeItem<Model> | void>;
    },
): {
    item: DynamoGeneralRealtimeItem<Model>;
    handleEventTransaction: Memo<
        (eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<unknown>>) => void
    >;
} {
    const context = useAppContext();

    const handleEventTransaction = useCallback(
        (eventTransaction: ReadonlyArray<DynamoGeneralRealtimeEvent<unknown>>) => {
            for (const event of eventTransaction) {
                if (event.item.key !== item.key) continue;

                switch (event.type) {
                    case "DeleteItem": {
                        onUpdateItem(item => {
                            // If our delete event is a higher version then what we have in state then set the
                            // `isDeleted` flag to true but keep the old item data around. This allows the
                            // developer to ignore deleted items and keep rendering data. An alternative would
                            // be to set the item to null but that would cause the existing UI to break which
                            // is generally not a good UX.
                            if (event.item.key === item.key && event.item.version > item.version) {
                                return {
                                    ...item,
                                    version: event.item.version,
                                    isDeleted: true,
                                };
                            }

                            return item;
                        });
                        break;
                    }
                    case "PutItem": {
                        onUpdateItem(item => {
                            // If our event transaction has a higher versioned item of the same key then update
                            // our state.
                            if (event.item.key === item.key && event.item.version > item.version) {
                                return event.item as DynamoGeneralRealtimeItem<Model>;
                            }

                            return item;
                        });
                        break;
                    }
                    default:
                        throw exhaustive(event);
                }
            }
        },
        [item.key, onUpdateItem],
    );

    // Subscribe to events when we are connected...
    useEffect(() => {
        if (!isConnected) return;

        return subscribeToEvents(handleEventTransaction);
    }, [isConnected, subscribeToEvents, handleEventTransaction]);

    // Whenever we connect to our WebSocket, we need to reload our realtime item in
    // case we missed any realtime updates while we were disconnected. Going forward we
    // should receive realtime updates from `subscribeToEvents()`.
    //
    // Two cases to consider:
    //
    // 1. The user is on a bus. They're currently online and are receiving realtime
    //    updates. They go through a tunnel and their WebSocket connection is
    //    disconnected. When they are out of the tunnel their device connects back to
    //    the internet and the WebSocket connection is resumed. However, during their
    //    time in the tunnel their item received a realtime update. So we reload when
    //    the WebSocket reconnects to catch that update.
    //
    // 2. The user loads the app in a new browser. It takes ~1s from the time they
    //    enter the URL in their browser to the time the app opens. During that second
    //    there was a realtime event, however their realtime item was fetched with
    //    eventual consistency at the start of our load so the item doesn't have that
    //    change. Once we connect to our realtime WebSocket we're guaranteed to get all
    //    realtime events going forward. So reload to make sure we also haven't missed
    //    any updates during the page load.
    const lastReloadedKeyRef = useRef<DynamoItemKey | null>(null);
    useEffect(() => {
        if (!isConnected) {
            // Clear the last reloaded key when we go disconnect. That way when we reconnect we
            // will reload the item.
            lastReloadedKeyRef.current = null;
            return;
        }

        if (lastReloadedKeyRef.current === item.key) return;
        lastReloadedKeyRef.current = item.key;

        reloadItemWithStrongReadConsistency().then(
            newItem => {
                if (!newItem) return;

                onUpdateItem(item => {
                    // If our event transaction has a higher versioned item of the same key then update
                    // our state.
                    if (newItem.key === item.key && newItem.version > item.version) {
                        return newItem;
                    }

                    return item;
                });
            },
            error => {
                context.tracer.getRoot().logException("Failed to reload realtime item", error);
            },
        );
    }, [context.tracer, item.key, isConnected, reloadItemWithStrongReadConsistency, onUpdateItem]);

    return {
        item,
        handleEventTransaction,
    };
}
