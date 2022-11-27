// TODO(calebmer): Some kind of test or codegen to ensure all network function
// implementations are actually imported.

import "~/server/network/alpha_network_implementation";
import "~/server/network/documents_network_implementation";
import "~/shared/network/all_network_definitions";

import {
    NetworkChannelImplementation,
    getNetworkChannelImplementationIfExists,
} from "~/server/network/internal/implement_network_channel";
import {
    NetworkFunctionImplementation,
    getNetworkFunctionImplementationIfExists,
} from "~/server/network/internal/implement_network_function";
import {
    NetworkPresenceChannelImplementation,
    getNetworkPresenceChannelImplementationIfExists,
} from "~/server/network/internal/implement_network_presence_channel";

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
