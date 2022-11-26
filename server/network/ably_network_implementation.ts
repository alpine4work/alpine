import {SignJWT} from "jose";
import {ablyApiKey} from "~/server/env/env_variables";
import {authorizeNetworkChannel} from "~/server/network/internal/authorize_network_channel";
import {implementNetworkFunction} from "~/server/network/internal/implement_network_function";
import {InvalidArgumentError, PermissionDeniedError} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {assert} from "~/shared/helpers/control/assert";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal";
import {isPlainObject} from "~/shared/helpers/object/is_plain_object";
import * as definition from "~/shared/network/ably_network_definition";

/**
 * Splits our [Ably API key][1] into the ID and secret part. The ID part is
 * included in JWTs we generate and the secret part is used to sign the JWTs.
 *
 * [1]: https://faqs.ably.com/what-is-an-app-api-key
 */
const [ablyApiKeyId = "", ablyApiKeySecret = ""] = ablyApiKey.split(":");
assert(ablyApiKeyId.length > 0);
assert(ablyApiKeySecret.length > 0);

implementNetworkFunction(definition.authenticateAbly, async (context, input) => {
    let capability: unknown;
    try {
        capability =
            typeof input.capability === "string" ? JSON.parse(input.capability) : input.capability;
    } catch (error) {
        throw new InvalidArgumentError(
            'Expected "capability" to be an object or JSON object string',
            {cause: error},
        );
    }

    if (!isPlainObject(capability))
        throw new InvalidArgumentError('Expected "capability" to be an object');

    // Authorize every requested channel capability in parallel. The network
    // authorization functions are expected to throw if the user is not allowed to
    // access a particular channel.
    await runAllPromises(
        Object.entries(capability).map(async ([channelName, channelCapabilities]) => {
            if (!Array.isArray(channelCapabilities))
                throw new InvalidArgumentError(
                    'Expected "capability" values to be an array of capability operations',
                );

            // Actually run the authorization function for our `NetworkChannel` or
            // `NetworkPresenceChannel`. This function will throw if we don't have access.
            const {channelType} = await authorizeNetworkChannel(channelName);

            const expectedChannelCapabilities =
                channelType === "PresenceChannel"
                    ? new Set(["subscribe", "presence"])
                    : new Set(["subscribe"]);

            if (!isDeepEqual(new Set(channelCapabilities), expectedChannelCapabilities))
                throw new PermissionDeniedError("Only permitted to subscribe to an Ably channel");
        }),
    );

    // We use the browser id as the Ably client id. An attacker can't spoof the
    // browser id because it is a part of our signed session cookie.
    const ablyClientId = await context.getBrowserId();

    // Yay! All our channels are authorized. Send a short-lived JWT token to the
    // client for subscribing to Ably messages.
    const token = await new SignJWT({
        "x-ably-capability": JSON.stringify(capability),
        "x-ably-clientId": ablyClientId,
    })
        .setProtectedHeader({alg: "HS256", typ: "JWT", kid: ablyApiKeyId})
        .setIssuedAt()
        .setExpirationTime("10m")
        .sign(new TextEncoder().encode(ablyApiKeySecret));

    return {token};
});
