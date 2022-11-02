// TODO(calebmer): Some kind of test or codegen to ensure all network function
// implementations are actually imported.

import "~/server/helpers/server-only.server";

import "~/server/network/ably-network-implementation";
import "~/server/network/documents-network-implementation";
import "~/shared/network/all-network-definitions";

import {
    NetworkChannelImplementation,
    getNetworkChannelImplementationIfExists,
} from "~/server/network/internal/implement-network-channel";
import {
    NetworkFunctionImplementation,
    getNetworkFunctionImplementationIfExists,
} from "~/server/network/internal/implement-network-function";
import {
    NetworkPresenceChannelImplementation,
    getNetworkPresenceChannelImplementationIfExists,
} from "~/server/network/internal/implement-network-presence-channel";

/**
 * Get the implementation for a network function with the given name.
 *
 * Importing this module also imports all network function implementations so
 * we know that all implementations exist.
 */
export function getNetworkFunctionImplementation(
    name: string,
): NetworkFunctionImplementation | null {
    return getNetworkFunctionImplementationIfExists(name);
}

/**
 * Get the implementation for a network channel with the given name.
 *
 * Importing this module also imports all network channel implementations so
 * we know that all implementations exist.
 */
export function getNetworkChannelImplementation(
    name: string,
): NetworkChannelImplementation<any> | null {
    return getNetworkChannelImplementationIfExists(name);
}

/**
 * Get the implementation for a network presence channel with the given name.
 *
 * Importing this module also imports all network presence channel
 * implementations so we know that all implementations exist.
 */
export function getNetworkPresenceChannelImplementation(
    name: string,
): NetworkPresenceChannelImplementation<any> | null {
    return getNetworkPresenceChannelImplementationIfExists(name);
}
