import {assert} from "~/shared/helpers/control/assert";
import {quote} from "~/shared/helpers/string/quote";
import {NetworkPresenceChannel} from "~/shared/network/network_presence_channel";
import {ObjectSchema} from "~/shared/schema/schema";

export type NetworkPresenceChannelImplementation<Key extends {[key: string]: string}> = {
    readonly type: "PresenceChannel";
    readonly keySchema: ObjectSchema<Key>;
    authorize(key: Key): Promise<void>;
};

/**
 * Implements authorization for a network presence channel on the server.
 * Network presence channels are defined in `~/shared/network` and
 * authorization is implemented in `~/server/network`.
 *
 * Once authorized, any client can publish its state to a presence channel.
 *
 * Throw a `PermissionDeniedError` error if the current user is unauthorized to
 * access a channel.
 */
export function implementNetworkPresenceChannelAuthorization<
    Key extends {[key: string]: string},
    State,
>(channel: NetworkPresenceChannel<Key, State>, authorize: (key: Key) => Promise<void>) {
    assert(
        !networkPresenceChannelImplementationByName.has(channel.name),
        quote`An implementation for network channel ${channel.name} already exists`,
    );

    const implementation: NetworkPresenceChannelImplementation<Key> = {
        type: "PresenceChannel",
        keySchema: channel.keySchema,
        authorize,
    };

    networkPresenceChannelImplementationByName.set(channel.name, implementation);
}

const networkPresenceChannelImplementationByName = new Map<
    string,
    NetworkPresenceChannelImplementation<any>
>();

/**
 * Get the names of all network functions that have been implemented.
 */
export function getAllImplementedNetworkPresenceChannelNames(): IterableIterator<string> {
    return networkPresenceChannelImplementationByName.keys();
}

/**
 * Get the implementation for a network channel with the given name if it has
 * been implemented by now. Usually you will want import
 * `~/server/network/all-network-implementations` to make sure all network
 * function implementations have been initialized.
 */
export function getNetworkPresenceChannelImplementationIfExists(
    name: string,
): NetworkPresenceChannelImplementation<any> | null {
    return networkPresenceChannelImplementationByName.get(name) ?? null;
}
