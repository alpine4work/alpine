import {ablyRealtimeClient} from "~/client/network/internal/ably-realtime-client";
import {InternalError} from "~/shared/error/error";
import {createPromiseResolver} from "~/shared/helpers/async/promise-resolver";
import {waitForAbort} from "~/shared/helpers/async/wait-for-abort";
import {asyncIterableIteratorMap} from "~/shared/helpers/iterable/async-iterable-iterator-map";
import {BlockInference} from "~/shared/helpers/types/block-inference";
import {getAblyChannelNameForNetworkChannel} from "~/shared/network/helpers/get-ably-channel-name-for-network-channel";
import {NetworkChannel} from "~/shared/network/network-channel";
import {SchemaDeserializationError, SchemaSerializedValue} from "~/shared/schema/schema";

/**
 * Subscribe to all messages from the provided network channel with the
 * provided key. Returns an async iterator so we can process messages with a
 * `for await ()` loop.
 *
 * To stop receiving messages, you should pass in an `AbortSignal`
 */
export function subscribeToNetworkChannel<
    Key extends {[key: string]: string},
    Message extends {type: string},
>(
    channel: NetworkChannel<Key, Message>,
    key: BlockInference<Key>,
    {signal}: {signal: AbortSignal},
): AsyncIterableIterator<Message> {
    const ablyChannelName = getAblyChannelNameForNetworkChannel(channel, key);

    return asyncIterableIteratorMap(subscribeToAblyChannel(ablyChannelName, {signal}), message => {
        try {
            return channel.messageSchema.deserialize(message);
        } catch (error) {
            // Reclassify deserialization errors as internal errors if we can't deserialize
            // the data coming from our network channel WebSocket.
            if (error instanceof SchemaDeserializationError) {
                throw new InternalError(error.message, {cause: error});
            }
            throw error;
        }
    });
}

async function* subscribeToAblyChannel(
    channelName: string,
    {signal}: {signal: AbortSignal},
): AsyncIterableIterator<SchemaSerializedValue> {
    let nextPromiseResolver = createPromiseResolver<SchemaSerializedValue>();

    const handleMessage = (message: SchemaSerializedValue) => {
        nextPromiseResolver.resolve(message);
        nextPromiseResolver = createPromiseResolver();
    };

    const unsubscribe = await ablyRealtimeClient.subscribeToMessages(channelName, handleMessage);

    try {
        const abortPromise = waitForAbort(signal);

        while (true) {
            // Our promise resolver awaits forever if there are no new messages. So we race
            // it with an `AbortSignal` so we can abort subscribing to messages.
            const message = await Promise.race([nextPromiseResolver.promise, abortPromise]);

            yield message;
        }
    } finally {
        await unsubscribe();
    }
}
