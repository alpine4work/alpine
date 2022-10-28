import Ably from "ably";
import {InternalError} from "~/shared/error/error";
import {createPromiseResolver} from "~/shared/helpers/async/promise-resolver";
import {waitForAbort} from "~/shared/helpers/async/wait-for-abort";
import {waitMicrotask} from "~/shared/helpers/async/wait-microtask";
import {assert} from "~/shared/helpers/control/assert";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {isDeepEqual} from "~/shared/helpers/control/is-deep-equal";
import {ImmutableMap} from "~/shared/helpers/immutable/immutable-map";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get-or-set-default-map-value";
import {authenticateAbly} from "~/shared/network/ably-network-definition";
import {SchemaSerializedValue} from "~/shared/schema/schema";

/**
 * A wrapper around the Ably realtime client to automatically handle
 * authorization and channel garbage collection.
 */
class AblyRealtimeClient {
    /**
     * The underlying Ably client. It is constructed lazily the first time we need
     * it. After constructing the client, we should immediately call `authorize()`
     * with the appropriate capabilities.
     */
    private _client: Ably.Types.RealtimePromise | null = null;

    /**
     * All of the attached channels for this client.
     */
    private readonly _attachedChannelByName = new Map<
        string,
        {
            /**
             * Capabilities we need to request for this channel.
             */
            readonly capabilityOperations: ReadonlyArray<Ably.Types.CapabilityOp>;
            /**
             * Increments whenever some code subscribes to a channel. Decrements whenever
             * some code unsubscribes from a channel.
             *
             * When the reference count reaches zero we will remove the channel from this
             * map and detach it so our client stops receiving events for that channel.
             */
            referenceCount: number;
            /**
             * Resolves with the channel object once the client is authorized (with
             * capability to access this channel) and the channel has been attached.
             *
             * If the promise rejects, then the channel was not attached.
             */
            readonly promise: Promise<Ably.Types.RealtimeChannelPromise>;
        }
    >();

    /**
     * The presence sessions we have for each channel name. Each presence session
     * holds a referenced to an attached channel.
     */
    private readonly _presenceSessionByChannelName = new Map<
        string,
        {
            referenceCount: number;
            readonly promise: Promise<AblyRealtimeClientPresenceSession>;
        }
    >();

    private _scheduledGetClientAndAuthorizePromise: Promise<Ably.Types.RealtimePromise> | null =
        null;

    /**
     * Gets the client and authorizes it. If the client does not already exist we
     * will create it.
     *
     * If called multiple times synchronously, we will only make one authorization
     * request.
     */
    private _getClientAndAuthorize(): Promise<Ably.Types.RealtimePromise> {
        assert(typeof window !== "undefined", "Can only get Ably realtime client in the browser");

        if (!this._scheduledGetClientAndAuthorizePromise) {
            this._scheduledGetClientAndAuthorizePromise = (async () => {
                // Wait for a microtask then clear our scheduled promise. During that microtask
                // we will only make one authorization request with any channels accumulated
                // during the microtask.
                await waitMicrotask();
                this._scheduledGetClientAndAuthorizePromise = null;

                // Lazily construct the Ably client. We need to send an authorization request
                // immediately after constructing the Ably client so it doesn't try to
                // authorize with full capabilities.
                if (this._client === null) {
                    const actuallyAuthenticateAbly = async (
                        tokenParams: Ably.Types.TokenParams,
                    ): Promise<string> => {
                        assert(tokenParams.capability);
                        const {token} = await authenticateAbly({
                            capability: tokenParams.capability,
                        });
                        return token;
                    };

                    this._client = new Ably.Realtime.Promise({
                        // Reduced message cost since we aren't charged for receiving an
                        // echo message:
                        // https://faqs.ably.com/how-does-ably-count-messages
                        echoMessages: false,

                        // Ably errors should reject promises so we will see them through that. We
                        // don't also need to log them.
                        //
                        // TODO(calebmer): When we have telemetry setup, log Ably errors to telemetry.
                        log: {level: 0},

                        authCallback: (tokenParams, callback) => {
                            actuallyAuthenticateAbly(tokenParams).then(
                                token => callback(null, token),
                                error =>
                                    // Ably `authCallback` error handling doesn't accept error objects...
                                    callback(error instanceof Error ? error.message : error, null),
                            );
                        },
                    });
                }

                const client = this._client;

                const capability: {[key: string]: Array<Ably.Types.CapabilityOp>} =
                    Object.fromEntries(
                        Array.from(
                            this._attachedChannelByName,
                            ([channelName, attachedChannel]) => [
                                channelName,
                                attachedChannel.capabilityOperations.slice(),
                            ],
                        ),
                    );

                // Send an authorization request.
                //
                // If another `_getClientAndAuthorize()` call is made before this promise
                // resolves we should send another authorization request.
                await client.auth.authorize({capability});

                return client;
            })();
        }
        return this._scheduledGetClientAndAuthorizePromise;
    }

    /**
     * Gets an attached and authorized channel. If the channel is not already
     * attached then we will attach it.
     *
     * Also increments an internal reference count. When you are done with the
     * channel please call `decrementReferenceCount()` once. Once the reference
     * count reaches zero we will clean up the memory for the channel and detach it
     * so we stop getting messages.
     */
    private _getAttachedChannelAndIncrementReferenceCount(
        channelName: string,
        {capabilityOperations}: {capabilityOperations: ReadonlyArray<Ably.Types.CapabilityOp>},
    ): Promise<{
        channel: Ably.Types.RealtimeChannelPromise;
        decrementReferenceCount: () => Promise<void>;
    }> {
        const attachedChannel = getOrSetDefaultMapValue(
            this._attachedChannelByName,
            channelName,
            () => ({
                capabilityOperations,
                referenceCount: 0,
                promise: (async () => {
                    // Whenever we encounter a new channel name we need to send a new authorization
                    // request to get a token that allows us to subscribe to that channel.
                    const client = await this._getClientAndAuthorize();

                    const channel = client.channels.get(channelName);

                    // Make sure to attach the channel before we return it. We expect only attached
                    // channels to exist in our map.
                    await channel.attach();

                    return channel;
                })(),
            }),
        );

        if (!isDeepEqual(attachedChannel.capabilityOperations, capabilityOperations))
            throw new InternalError("Can not change capabilities of an already attached channel");

        attachedChannel.referenceCount++;

        let channel: Ably.Types.RealtimeChannelPromise | null = null;

        const decrementReferenceCount = async () => {
            attachedChannel.referenceCount--;

            // Once all references have been removed...
            if (attachedChannel.referenceCount === 0) {
                // Remove from our channel map.
                this._attachedChannelByName.delete(channelName);

                // If our channel successfully resolved, then we need to detach it so we stop
                // getting realtime messages.
                await channel?.detach();

                // Release from Ably as well so we don't have a memory leak since Ably keeps
                // around references to channel objects.
                this._client?.channels.release(channelName);
            }
        };

        return attachedChannel.promise.then(
            resolvedChannel => {
                channel = resolvedChannel;
                return {channel, decrementReferenceCount};
            },
            async error => {
                await decrementReferenceCount();
                throw error;
            },
        );
    }

    /**
     * Subscribes to messages from a channel over time.
     *
     * Callers need to pass in an `AbortSignal` and abort it when they are done
     * listening to messages. This will stop the iterator from returning messages
     * and cleanup our Ably subscription.
     */
    public async *subscribeToMessages(
        channelName: string,
        {signal}: {signal: AbortSignal},
    ): AsyncIterableIterator<SchemaSerializedValue> {
        const {channel, decrementReferenceCount} =
            await this._getAttachedChannelAndIncrementReferenceCount(channelName, {
                capabilityOperations: ["subscribe"],
            });

        try {
            let nextPromiseResolver = createPromiseResolver<SchemaSerializedValue>();

            const handleMessage = (message: Ably.Types.Message) => {
                // Ignore message names we're unfamiliar with so we can evolve the
                // protocol in the future.
                if (message.name !== "message") return;

                nextPromiseResolver.resolve(message.data);
                nextPromiseResolver = createPromiseResolver();
            };

            await channel.subscribe(handleMessage);

            try {
                const abortPromise = waitForAbort(signal);

                while (true) {
                    // Our promise resolver awaits forever if there are no new messages. So we race
                    // it with an `AbortSignal` so we can abort subscribing to messages.
                    const message = await Promise.race([nextPromiseResolver.promise, abortPromise]);

                    yield message;
                }
            } finally {
                channel.unsubscribe(handleMessage);
            }
        } finally {
            await decrementReferenceCount();
        }
    }

    /**
     * Mark our client as online and communicate its presence state to other
     * clients connected to this channel.
     *
     * Before sending an enter message to other clients, we first need to
     * authenticate with our server and connect to Ably.
     *
     * If you want to update the client's presence state then use the `update()`
     * method on the returned session.
     *
     * When you are done with the presence session call the `leave()` method. This
     * will also end our Ably connection for the channel if there are no other
     * subscribers.
     */
    public enterWithPresenceState(
        channelName: string,
        presenceState: SchemaSerializedValue,
    ): Promise<AblyRealtimeClientPresenceSession> {
        let hasEnteredWithPresenceState = false;

        const presenceSession = getOrSetDefaultMapValue(
            this._presenceSessionByChannelName,
            channelName,
            () => ({
                referenceCount: 0,
                promise: (async (): Promise<AblyRealtimeClientPresenceSession> => {
                    const {channel, decrementReferenceCount} =
                        await this._getAttachedChannelAndIncrementReferenceCount(channelName, {
                            capabilityOperations: ["subscribe", "presence"],
                        });

                    try {
                        hasEnteredWithPresenceState = true;
                        await channel.presence.enter(presenceState);

                        let hasLeft = false;

                        return {
                            update: async presenceState => {
                                if (hasLeft) return;
                                await channel.presence.update(presenceState);
                            },
                            leave: async () => {
                                if (hasLeft) return;
                                hasLeft = true;
                                await channel.presence.leave();
                                await decrementReferenceCount();
                            },
                        };
                    } catch (error) {
                        await decrementReferenceCount();
                        throw error;
                    }
                })(),
            }),
        );

        presenceSession.referenceCount++;

        return presenceSession.promise.then(
            async actualPresenceSession => {
                // If we are reusing an existing session then update the state instead of
                // entering fresh.
                if (!hasEnteredWithPresenceState) {
                    await actualPresenceSession.update(presenceState);
                }

                return {
                    ...actualPresenceSession,
                    leave: async () => {
                        presenceSession.referenceCount--;

                        if (presenceSession.referenceCount === 0) {
                            this._presenceSessionByChannelName.delete(channelName);
                            await actualPresenceSession.leave();
                        }
                    },
                };
            },
            error => {
                presenceSession.referenceCount--;

                // If we have zero reference counts in the error code path, that means we never
                // entered so we also don't need to leave.
                if (presenceSession.referenceCount === 0) {
                    this._presenceSessionByChannelName.delete(channelName);
                }

                throw error;
            },
        );
    }

    /**
     * Subscribes to the presence states for all clients on this channel.
     *
     * Callers need to pass in an `AbortSignal` and abort it when they are done
     * listening to presence states. This will stop the iterator from returning
     * messages and cleanup our Ably subscription.
     *
     * Our own client's presence state will not be included in this map.
     */
    public async *subscribeToPresenceStates(
        channelName: string,
        {signal}: {signal: AbortSignal},
    ): AsyncIterableIterator<ImmutableMap<string, SchemaSerializedValue>> {
        const {channel, decrementReferenceCount} =
            await this._getAttachedChannelAndIncrementReferenceCount(channelName, {
                capabilityOperations: ["subscribe", "presence"],
            });

        try {
            let presenceStateByConnectionKey = ImmutableMap.empty<string, SchemaSerializedValue>();
            let nextPromiseResolver = createPromiseResolver();

            const handleMessage = (message: Ably.Types.PresenceMessage) => {
                const connectionKey = `${message.clientId}:${message.connectionId}`;

                const ourConnectionKey =
                    this._client && this._client.connection.id !== undefined
                        ? `${this._client.auth.clientId}:${this._client.connection.id}`
                        : null;

                switch (message.action) {
                    case "present":
                    case "enter":
                    case "update": {
                        // Don't include our presence state in the map.
                        if (ourConnectionKey && connectionKey === ourConnectionKey) break;

                        presenceStateByConnectionKey = presenceStateByConnectionKey.set(
                            connectionKey,
                            message.data,
                        );

                        nextPromiseResolver.resolve();
                        nextPromiseResolver = createPromiseResolver();
                        break;
                    }
                    case "leave": {
                        presenceStateByConnectionKey =
                            presenceStateByConnectionKey.delete(connectionKey);

                        nextPromiseResolver.resolve();
                        nextPromiseResolver = createPromiseResolver();
                        break;
                    }
                    case "absent":
                        // Documented as an internal event.
                        break;
                    default:
                        throw exhaustive(message.action);
                }
            };

            // Get the initial presence messages when subscribing to the channel. The first
            // time we sync with the server this may take a couple milliseconds but after
            // that Ably should keep this list up-to-date in memory.
            //
            // We re-create this list as an `ImmutableMap` so we have an immutable type
            // with efficient updates. We expect the number of connected clients to get
            // large with frequent updates so hopefully the `ImmutableMap` is a worthwhile
            // optimization.
            for (const message of await channel.presence.get()) {
                handleMessage(message);
            }

            await channel.presence.subscribe(handleMessage);

            try {
                const abortPromise = waitForAbort(signal);

                while (true) {
                    // Our promise resolver awaits forever if there are no new messages. So we race
                    // it with an `AbortSignal` so we can abort subscribing to messages.
                    await Promise.race([nextPromiseResolver.promise, abortPromise]);

                    yield presenceStateByConnectionKey;
                }
            } finally {
                channel.presence.unsubscribe(handleMessage);
            }
        } catch (error) {
            await decrementReferenceCount();
            throw error;
        }
    }
}

export const ablyRealtimeClient = new AblyRealtimeClient();

export type AblyRealtimeClientPresenceSession = {
    update(presenceState: SchemaSerializedValue): Promise<void>;
    leave(): Promise<void>;
};
