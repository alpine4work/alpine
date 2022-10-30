import {ablyRealtimeClient} from "~/client/network/internal/ably-realtime-client";
import {InternalError} from "~/shared/error/error";
import {mapAsyncIterableIterator} from "~/shared/helpers/iterable/map-async-iterable-iterator";
import {BlockInference} from "~/shared/helpers/types/block-inference";
import {getAblyChannelNameForNetworkChannel} from "~/shared/network/helpers/get-ably-channel-name-for-network-channel";
import {NetworkChannel} from "~/shared/network/network-channel";
import {SchemaDeserializationError} from "~/shared/schema/schema";

/**
 * Subscribe to all messages from the provided network channel with the
 * provided key. Returns an async iterator so we can process messages with a
 * `for await ()` loop.
 *
 * To stop receiving messages, you should pass in an `AbortSignal`.
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

    return mapAsyncIterableIterator(
        ablyRealtimeClient.subscribeToMessages(ablyChannelName, {signal}),
        message => {
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
        },
    );
}
