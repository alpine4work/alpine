import {
    getNetworkChannelImplementation,
    getNetworkPresenceChannelImplementation,
} from "~/server/network/all_network_implementations";
import {NetworkChannelImplementation} from "~/server/network/internal/implement_network_channel";
import {NetworkPresenceChannelImplementation} from "~/server/network/internal/implement_network_presence_channel";
import {InvalidArgumentError, NotFoundError} from "~/shared/error/error";
import {SchemaSerializedValue} from "~/shared/schema/schema";

/**
 * Authorizes a network channel or network presence channel from an Ably
 * channel name.
 *
 * Returns the type of channel we authorized.
 */
export async function authorizeNetworkChannel(
    channelName: string,
): Promise<{channelType: "Channel" | "PresenceChannel"}> {
    const {implementation, channelNameKeyParts} =
        getNetworkChannelImplementationFromAblyChannelName(channelName);

    const serializedKey: SchemaSerializedValue = {};

    let index = 0;
    for (const [key, propertySchema] of implementation.keySchema.propertySchemaByKey) {
        (serializedKey as any)[propertySchema.serializedKey ?? key] = channelNameKeyParts[index++];
    }

    const key = implementation.keySchema.deserialize(serializedKey);

    await implementation.authorize(key);

    return {channelType: implementation.type};
}

function getNetworkChannelImplementationFromAblyChannelName(channelName: string): {
    implementation: NetworkChannelImplementation<any> | NetworkPresenceChannelImplementation<any>;
    channelNameKeyParts: Array<string>;
} {
    const channelNameParts = channelName.split(":");

    if (channelNameParts[0] !== "network")
        throw new InvalidArgumentError(
            'Expected Ably channel name to be in the "network" namespace',
        );

    if (!channelNameParts[1])
        throw new InvalidArgumentError(
            "Expected network channel name to be second part of Ably channel name",
        );

    for (const channelNamePart of channelNameParts)
        if (channelNamePart.includes("*"))
            throw new InvalidArgumentError("Unexpected wildcard in Ably channel name");

    const channelNameKeyParts = channelNameParts.slice(2);

    const networkChannelImplementation = getNetworkChannelImplementation(channelNameParts[1]);
    if (networkChannelImplementation) {
        return {
            implementation: networkChannelImplementation,
            channelNameKeyParts,
        };
    }

    const networkPresenceChannelImplementation = getNetworkPresenceChannelImplementation(
        channelNameParts[1],
    );
    if (networkPresenceChannelImplementation) {
        return {
            implementation: networkPresenceChannelImplementation,
            channelNameKeyParts,
        };
    }

    throw new NotFoundError(
        "Could not find an implementation for network channel name in Ably channel name",
    );
}
