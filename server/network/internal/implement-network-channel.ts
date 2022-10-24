import {InvalidArgumentError} from "~/shared/error/error";
import {assert} from "~/shared/helpers/control/assert";
import {quote} from "~/shared/helpers/string/quote";
import {NetworkChannel} from "~/shared/network/network-channel";
import {SchemaSerializedValue} from "~/shared/schema/schema";

export type NetworkChannelImplementation = {
    authorize(channelName: string): Promise<void>;
};

/**
 * Implements authorization for a network channel on the server. Network
 * channels are defined in `~/shared/network` and authorization is implemented
 * in `~/server/network`. Any code in `~/server` can publish a message to a
 * channel with `publishMessageToNetworkChannel()`.
 *
 * Throw a `PermissionDeniedError` error if the current user is unauthorized to
 * access a channel.
 */
export function implementNetworkChannelAuthorization<
    Key extends {[key: string]: string},
    Message extends {type: string},
>(networkChannel: NetworkChannel<Key, Message>, implementation: (key: Key) => Promise<void>) {
    assert(
        !networkChannelImplementationByName.has(networkChannel.name),
        quote`An implementation for network channel ${networkChannel.name} already exists`,
    );

    const authorize = async (channelName: string): Promise<void> => {
        const channelNameParts = channelName.split(":");

        if (channelNameParts[0] !== "network")
            throw new InvalidArgumentError(
                'Expected channel name to be in the "network" namespace',
            );

        if (!channelNameParts[1])
            throw new InvalidArgumentError(
                "Expected network channel name to be second part of channel name",
            );

        for (const channelNamePart of channelNameParts)
            if (channelNamePart.includes("*"))
                throw new InvalidArgumentError("Unexpected wildcard channel name part");

        const serializedKey: SchemaSerializedValue = {};

        let index = 2;
        for (const [key, propertySchema] of networkChannel.keySchema.propertySchemaByKey) {
            (serializedKey as any)[propertySchema.serializedKey ?? key] = channelNameParts[index++];
        }

        const key = networkChannel.keySchema.deserialize(serializedKey);

        await implementation(key);
    };

    networkChannelImplementationByName.set(networkChannel.name, {
        authorize,
    });
}

const networkChannelImplementationByName = new Map<string, NetworkChannelImplementation>();

/**
 * Get the names of all network functions that have been implemented.
 */
export function getAllImplementedNetworkChannelNames(): IterableIterator<string> {
    return networkChannelImplementationByName.keys();
}

/**
 * Get the implementation for a network channel with the given name if it has
 * been implemented by now. Usually you will want import
 * `~/server/network/all-network-implementations` to make sure all network
 * function implementations have been initialized.
 */
export function getNetworkChannelImplementationIfExists(
    name: string,
): NetworkChannelImplementation | null {
    return networkChannelImplementationByName.get(name) ?? null;
}
