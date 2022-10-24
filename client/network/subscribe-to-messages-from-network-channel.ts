import Ably from "ably";
import {InternalError} from "~/shared/error/error";
import {PromiseResolver, createPromiseResolver} from "~/shared/helpers/async/promise-resolver";
import {waitMicrotask} from "~/shared/helpers/async/wait-microtask";
import {assert} from "~/shared/helpers/control/assert";
import {unwrapResultPromise} from "~/shared/helpers/control/capture-result-promise";
import {Result} from "~/shared/helpers/control/result";
import {asyncIterableIteratorMap} from "~/shared/helpers/iterable/async-iterable-iterator-map";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get-or-set-default-map-value";
import {BlockInference} from "~/shared/helpers/types/block-inference";
import {authenticateAbly} from "~/shared/network/ably-network-definition";
import {getAblyChannelNameForNetworkChannel} from "~/shared/network/helpers/get-ably-channel-name-for-network-channel";
import {NetworkChannel} from "~/shared/network/network-channel";
import {SchemaDeserializationError, SchemaSerializedValue} from "~/shared/schema/schema";

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
            channelPromise: Promise<Ably.Types.RealtimeChannelPromise>;
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
                        Array.from(this._attachedChannelByName.keys(), channelName => [
                            channelName,
                            ["subscribe"],
                        ]),
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
    private _getAttachedChannelAndIncrementReferenceCount(channelName: string): {
        channelPromise: Promise<Ably.Types.RealtimeChannelPromise>;
        decrementReferenceCount: () => Promise<void>;
    } {
        const attachedChannel = getOrSetDefaultMapValue(
            this._attachedChannelByName,
            channelName,
            () => ({
                referenceCount: 0,
                channelPromise: (async () => {
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

        attachedChannel.referenceCount++;

        return {
            channelPromise: attachedChannel.channelPromise,
            decrementReferenceCount: async () => {
                attachedChannel.referenceCount--;

                if (attachedChannel.referenceCount === 0) {
                    this._attachedChannelByName.delete(channelName);

                    // Release from Ably as well so we don't have a memory leak since Ably keeps
                    // around references to channel objects.
                    this._client?.channels.release(channelName);

                    // Ignore any errors in the channel promise. If there was an error then the
                    // channel did not successfully attach so we don't have to detach it.
                    let channel;
                    try {
                        channel = await attachedChannel.channelPromise;
                    } catch {
                        channel = null;
                    }

                    await channel?.detach();
                }
            },
        };
    }

    /**
     * Subscribes to a channel and calls `listener` with all messages sent to the
     * channel.
     *
     * Callers should call `unsubscribe` when they are done so we can clean up
     * resources.
     */
    public async subscribe(
        channelName: string,
        listener: (message: SchemaSerializedValue) => void,
    ): Promise<() => Promise<void>> {
        const {channelPromise, decrementReferenceCount} =
            this._getAttachedChannelAndIncrementReferenceCount(channelName);

        try {
            const channel = await channelPromise;

            const handleMessage = (message: Ably.Types.Message) => {
                // Ignore message names we're unfamiliar with so we can evolve the
                // protocol in the future.
                if (message.name !== "message") return;

                listener(message.data);
            };

            await channel.subscribe(handleMessage);

            // TODO(calebmer): Use the Ably history API to get messages between when data
            // loaded and when the channel was attached.
            // https://ably.com/docs/api/realtime-sdk/history

            return async () => {
                channel.unsubscribe(handleMessage);
                await decrementReferenceCount();
            };
        } catch (error) {
            await decrementReferenceCount();
            throw error;
        }
    }
}

const ablyRealtimeClient = new AblyRealtimeClient();

/**
 * Subscribe to all messages from the provided network channel with the
 * provided key. Returns an async iterator so we can process messages with a
 * `for await ()` loop.
 */
export async function subscribeToMessagesFromNetworkChannel<
    Key extends {[key: string]: string},
    Message extends {type: string},
>(
    networkChannel: NetworkChannel<Key, Message>,
    key: BlockInference<Key>,
): Promise<
    AsyncIterableIterator<Message> & {
        return(): void;
        throw(error: unknown): void;
    }
> {
    const ablyChannelName = getAblyChannelNameForNetworkChannel(networkChannel, key);

    const iterator = await subscribeToMessagesFromAblyChannel(ablyChannelName);

    const mappedIterator: AsyncIterableIterator<Message> = asyncIterableIteratorMap(
        iterator,
        message => {
            try {
                return networkChannel.messageSchema.deserialize(message);
            } catch (error) {
                // Reclassify deserialization errors as internal errors if we can't deserialize
                // the data coming from our network channel WebSocket.
                if (error instanceof SchemaDeserializationError) {
                    throw new InternalError(error.message, {cause: error});
                }
                throw error;
            }
        },
    );

    // eslint-disable-next-line @typescript-eslint/unbound-method
    assert(mappedIterator.return);
    // eslint-disable-next-line @typescript-eslint/unbound-method
    assert(mappedIterator.throw);

    return mappedIterator as any;
}

async function subscribeToMessagesFromAblyChannel(channelName: string): Promise<
    AsyncIterableIterator<SchemaSerializedValue> & {
        return(): void;
        throw(error: unknown): void;
    }
> {
    type Step = IteratorResult<SchemaSerializedValue, undefined>;

    // We use a `Result` so that we can create a fresh `Promise` every
    // time `next()` is called so that unhandled rejections are detected
    // separately for each `next()` call.
    let finalResult: Result<Step, unknown> | null = null;

    const resolverQueue: Array<PromiseResolver<Step>> = [];
    const messageQueue: Array<SchemaSerializedValue> = [];

    function handleMessage(message: SchemaSerializedValue) {
        if (finalResult !== null) return;

        const resolver = resolverQueue.shift();
        if (resolver) {
            resolver.resolve({done: false, value: message});
        } else {
            messageQueue.push(message);
        }
    }

    const actuallyUnsubscribe = await ablyRealtimeClient.subscribe(channelName, handleMessage);

    let isUnsubscribed = false;

    // Once the iterator has finished (`return` or `throw` was called) then
    // unsubscribe from the channel.
    //
    // We should only unsubscribe once since we'll only subscribe once.
    const unsubscribe = async () => {
        if (isUnsubscribed) return;
        isUnsubscribed = true;

        await actuallyUnsubscribe();
    };

    const iterator: AsyncIterableIterator<SchemaSerializedValue> & {
        return(): void;
        throw(error: unknown): void;
    } = {
        [Symbol.asyncIterator]: () => iterator,
        next: () => {
            // One of the queues must be empty at all times. If both queues have
            // an item at the same time then we have a bug in our code.
            assert(resolverQueue.length === 0 || messageQueue.length === 0);

            // When we end we return the same result forever.
            if (finalResult !== null) return unwrapResultPromise(finalResult);

            // Exhaust the response queue in the case where we haven’t had
            // resolvers waiting for values.
            const message = messageQueue.shift();
            if (message) return Promise.resolve({done: false, value: message});

            // If we have no ready responses then create a resolver which will be
            // called the next time we get data.
            const resolver = createPromiseResolver<Step>();
            resolverQueue.push(resolver);
            return resolver.promise;
        },
        return: () => {
            // When we end we return the same result forever.
            if (finalResult !== null) return unwrapResultPromise(finalResult);

            const result: Step = {done: true, value: undefined};
            finalResult = {ok: true, value: result};
            for (const {resolve} of resolverQueue) resolve(result);
            resolverQueue.length = 0;
            messageQueue.length = 0;

            // Unsubscribe after exhausting our resolver queue. If unsubscribing
            // fails we don't want those promises to hang.
            return unsubscribe().then(() => Promise.resolve(result));
        },
        throw: (error: unknown) => {
            // When we end we return the same result forever.
            if (finalResult !== null) return unwrapResultPromise(finalResult);

            finalResult = {ok: false, error};
            for (const {reject} of resolverQueue) reject(error);
            resolverQueue.length = 0;
            messageQueue.length = 0;

            // Unsubscribe after exhausting our resolver queue. If unsubscribing
            // fails we don't want those promises to hang.
            return unsubscribe().then(() => Promise.reject(error));
        },
    };

    return iterator;
}
