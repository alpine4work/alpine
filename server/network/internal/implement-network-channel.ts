import "~/server/helpers/server-only.server";

import {assert} from "~/shared/helpers/control/assert";
import {quote} from "~/shared/helpers/string/quote";
import {NetworkChannel} from "~/shared/network/network-channel";
import {ObjectSchema} from "~/shared/schema/schema";

export type NetworkChannelImplementation<Key extends {[key: string]: string}> = {
    readonly type: "Channel";
    readonly keySchema: ObjectSchema<Key>;
    authorize(key: Key): Promise<void>;
};

/**
 * Implements authorization for a network channel on the server. Network
 * channels are defined in `~/shared/network` and authorization is implemented
 * in `~/server/network`. Any code in `~/server` can publish a message to a
 * channel with `publishToNetworkChannel()`.
 *
 * Throw a `PermissionDeniedError` error if the current user is unauthorized to
 * access a channel.
 */
export function implementNetworkChannelAuthorization<
    Key extends {[key: string]: string},
    Message extends {type: string},
>(channel: NetworkChannel<Key, Message>, authorize: (key: Key) => Promise<void>) {
    assert(
        !networkChannelImplementationByName.has(channel.name),
        quote`An implementation for network channel ${channel.name} already exists`,
    );

    const implementation: NetworkChannelImplementation<Key> = {
        type: "Channel",
        keySchema: channel.keySchema,
        authorize,
    };

    networkChannelImplementationByName.set(channel.name, implementation);
}

const networkChannelImplementationByName = new Map<string, NetworkChannelImplementation<any>>();

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
): NetworkChannelImplementation<any> | null {
    return networkChannelImplementationByName.get(name) ?? null;
}
