import * as jwt from "jsonwebtoken";
import {getNetworkChannelImplementation} from "~/server/network/all-network-implementations";
import {implementNetworkFunction} from "~/server/network/internal/implement-network-function";
import {InvalidArgumentError, NotFoundError, PermissionDeniedError} from "~/shared/error/error";
import {runAllPromises} from "~/shared/helpers/async/run-all-promises";
import {assert} from "~/shared/helpers/control/assert";
import {isPlainObject} from "~/shared/helpers/object/is-plain-object";
import * as definition from "~/shared/network/ably-network-definition";

assert(process.env.ABLY_API_KEY);

/**
 * Splits our [Ably API key][1] into the ID and secret part. The ID part is
 * included in JWTs we generate and the secret part is used to sign the JWTs.
 *
 * [1]: https://faqs.ably.com/what-is-an-app-api-key
 */
const [ablyApiKeyId = "", ablyApiKeySecret = ""] = process.env.ABLY_API_KEY.split(":");
assert(ablyApiKeyId.length > 0);
assert(ablyApiKeySecret.length > 0);

implementNetworkFunction(definition.authenticateAbly, async input => {
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
            const channelNameParts = channelName.split(":");

            if (channelNameParts[0] !== "network")
                throw new PermissionDeniedError(
                    'Not authorized to subscribe to Ably channels outside of the "network" namespace',
                );

            if (!channelNameParts[1])
                throw new InvalidArgumentError("Missing network channel name in Ably channel name");

            for (const channelNamePart of channelNameParts)
                if (channelNamePart.includes("*"))
                    throw new PermissionDeniedError(
                        "Not authorized to subscribe to wildcard Ably channel names",
                    );

            if (
                !Array.isArray(channelCapabilities) ||
                channelCapabilities.length !== 1 ||
                channelCapabilities[0] !== "subscribe"
            ) {
                throw new PermissionDeniedError("Only permitted to subscribe to an Ably channel");
            }

            const networkChannelImplementation = getNetworkChannelImplementation(
                channelNameParts[1],
            );

            if (!networkChannelImplementation)
                throw new NotFoundError("Could not find an implementation for network channel");

            await networkChannelImplementation.authorize(channelName);
        }),
    );

    // Yay! All our channels are authorized. Send a short-lived JWT token to the
    // client for subscribing to Ably messages.
    const token = await new Promise<string>((resolve, reject) => {
        jwt.sign(
            {"x-ably-capability": JSON.stringify(capability)},
            ablyApiKeySecret,
            {keyid: ablyApiKeyId, expiresIn: "10m"},
            (error, token) => {
                if (error) reject(error);
                else resolve(token!); // eslint-disable-line @typescript-eslint/no-unnecessary-type-assertion
            },
        );
    });

    return {token};
});
