import {ablyApiKey} from "~/server/env/env_variables";
import {UnknownError} from "~/shared/error/error";
import {BlockInference} from "~/shared/helpers/types/block_inference";
import {getAblyChannelNameForNetworkChannel} from "~/shared/network/helpers/get_ably_channel_name_for_network_channel";
import {NetworkChannel} from "~/shared/network/network_channel";

const ablyApiKeyBase64 = btoa(ablyApiKey);

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

    const serializedMessage = channel.messageSchema.serialize(message as Message);

    // If we are in a Jest testing environment, then don't actually publish messages
    // over Ably that will count towards our quota. We shouldn't have Ably
    // subscribers either in Jest tests.
    //
    // If we want to test messages with Jest, we should have some kind of mock.
    if (typeof jest !== "undefined") return;

    // TODO(calebmer): Enable idempotent message publishing and give all messages an
    // id. Is there a way to automatically generate these idempotent ids? Maybe a hash
    // of the message + a request id?
    const response = await fetch(`https://rest.ably.io/channels/${ablyChannelName}/messages`, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            Accept: "application/json",
            Authorization: `Basic ${ablyApiKeyBase64}`,
            "X-Ably-Version": "1.2",
        },
        body: JSON.stringify({
            name: "message",
            data: serializedMessage,
        }),
    });

    const body = await response.json<{error: {code?: string; message: string}}>();

    if (response.status >= 400) {
        throw new UnknownError(
            `Ably error${body.error.code ? ` (code ${body.error.code})` : ""}: ${
                body.error.message
            }`,
        );
    }
}
