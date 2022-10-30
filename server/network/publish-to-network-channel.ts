import Ably from "ably";
import {assert} from "~/shared/helpers/control/assert";
import {BlockInference} from "~/shared/helpers/types/block-inference";
import {getAblyChannelNameForNetworkChannel} from "~/shared/network/helpers/get-ably-channel-name-for-network-channel";
import {NetworkChannel} from "~/shared/network/network-channel";

assert(process.env.ABLY_API_KEY);

// TODO(calebmer): Enable idempotent message publishing and give all messages an
// id. Is there a way to automatically generate these idempotent ids? Maybe a hash
// of the message + a request id?
const ablyRest = new Ably.Rest.Promise({key: process.env.ABLY_API_KEY});

/**
 * Publish a message to a network channel.
 */
export async function publishToNetworkChannel<
    Key extends {[key: string]: string},
    Message extends {type: string},
>(
    channel: NetworkChannel<Key, Message>,
    key: BlockInference<Key>,
    message: BlockInference<Message>,
): Promise<void> {
    const ablyChannelName = getAblyChannelNameForNetworkChannel(channel, key);

    // Immediately release the Ably channel after creating it so we don't have a
    // memory leak.
    //
    // NOTE(calebmer): In my opinion, this is a poor API design for the Ably
    // JavaScript SDK. By default you get memory leaks when using dynamic channel
    // keys because Ably lazily constructs channel objects and tries to keep it
    // around. It means the stateless REST client isn't actually stateless. What's
    // more is the code says [most users should ignore the `release()` function][1]
    // which seems, wrong, given I presume most users will need dynamic channel
    // names. Makes me feel like Ably is not designed for dynamic channels which
    // would disqualify us from using Ably. Someone give this feedback to Ably when
    // we are a paying customer, thanks.
    //
    // [1]: https://github.com/ably/ably-js/blob/369e9b5886d71394c996fc10fc5ab7d518d1363a/src/common/lib/client/rest.ts#L256-L272
    const ablyChannel = ablyRest.channels.get(ablyChannelName);
    ablyRest.channels.release(ablyChannelName);

    const serializedMessage = channel.messageSchema.serialize(message as Message);

    // If we are in a Jest testing environment, then don't actually publish messages
    // over Ably that will count towards our quota. We shouldn't have Ably
    // subscribers either in Jest tests.
    //
    // If we want to test messages with Jest, we should have some kind of mock.
    if (typeof jest !== "undefined") return;

    // Actually publish the message.
    await ablyChannel.publish("message", serializedMessage);
}
