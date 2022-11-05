import "~/server/network/all_network_implementations";

import {getAllImplementedNetworkChannelNames} from "~/server/network/internal/implement_network_channel";
import {getAllImplementedNetworkFunctionNames} from "~/server/network/internal/implement_network_function";
import {getAllImplementedNetworkPresenceChannelNames} from "~/server/network/internal/implement_network_presence_channel";
import {InternalError} from "~/shared/error/error";
import {quote} from "~/shared/helpers/string/quote";
// Allow this test to look at all defined network channels.
// eslint-disable-next-line no-internal-imports
import {getAllDefinedNetworkChannelNames} from "~/shared/network/internal/define_network_channel";
// Allow this test to look at all defined network functions.
// eslint-disable-next-line no-internal-imports
import {getAllDefinedNetworkFunctionNames} from "~/shared/network/internal/define_network_function";
// Allow this test to look at all defined network functions.
// eslint-disable-next-line no-internal-imports
import {getAllDefinedNetworkPresenceChannelNames} from "~/shared/network/internal/define_network_presence_channel";

test("all network function definitions have implementations", async () => {
    const allDefinedNetworkFunctionNames = getAllDefinedNetworkFunctionNames();
    const allImplementedNetworkFunctionNames = new Set(getAllImplementedNetworkFunctionNames());

    for (const definedNetworkFunctionName of allDefinedNetworkFunctionNames) {
        if (!allImplementedNetworkFunctionNames.has(definedNetworkFunctionName)) {
            throw new InternalError(
                quote`Network function ${definedNetworkFunctionName} was defined but not implemented`,
            );
        }
    }
});

test("all network channel definitions have implementations", async () => {
    const allDefinedNetworkChannelNames = getAllDefinedNetworkChannelNames();
    const allImplementedNetworkChannelNames = new Set(getAllImplementedNetworkChannelNames());

    for (const definedNetworkChannelName of allDefinedNetworkChannelNames) {
        if (!allImplementedNetworkChannelNames.has(definedNetworkChannelName)) {
            throw new InternalError(
                quote`Network channel ${definedNetworkChannelName} was defined but not implemented`,
            );
        }
    }
});

test("all network presence channel definitions have implementations", async () => {
    const allDefinedNetworkPresenceChannelNames = getAllDefinedNetworkPresenceChannelNames();
    const allImplementedNetworkPresenceChannelNames = new Set(
        getAllImplementedNetworkPresenceChannelNames(),
    );

    for (const definedNetworkPresenceChannelName of allDefinedNetworkPresenceChannelNames) {
        if (!allImplementedNetworkPresenceChannelNames.has(definedNetworkPresenceChannelName)) {
            throw new InternalError(
                quote`Network presence channel ${definedNetworkPresenceChannelName} was defined but not implemented`,
            );
        }
    }
});
