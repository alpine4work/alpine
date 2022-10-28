import {assert} from "~/shared/helpers/control/assert";
import {BlockInference} from "~/shared/helpers/types/block-inference";
import {NetworkChannelBase} from "~/shared/network/network-channel";

/**
 * Get the Ably channel name based on a channel definition and a key into
 * that channel.
 */
export function getAblyChannelNameForNetworkChannel<Key extends {[key: string]: string}>(
    channel: NetworkChannelBase<Key>,
    key: BlockInference<Key>,
) {
    const serializedKey = channel.keySchema.serialize(key as Key);

    // Channel names start with the `network` namespace and our channel name. Then
    // it is followed by the channel key.
    const keyParts = ["network", channel.name];

    for (const [key, propertySchema] of channel.keySchema.propertySchemaByKey) {
        const keyPart = serializedKey[propertySchema.serializedKey ?? key];
        assert(typeof keyPart === "string");
        const escapedKeyPart = JSON.stringify(keyPart)
            .replaceAll(":", "\\u003A")
            .replaceAll("*", "\\u002A");
        assert(escapedKeyPart.startsWith('"') && escapedKeyPart.endsWith('"'));
        keyParts.push(escapedKeyPart.slice(1, -1));
    }

    return keyParts.join(":");
}
