import {evaluateAccessPolicy} from "~/server/access/evaluate_access_policy.js";
import {ServerMinimalAccountActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {isBotSpaceAccount} from "~/server/spaces/is_bot_space_account.js";
import {AccessPolicy, validateAccessPolicyUpdate} from "~/shared/access/access_policy.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Validates an access policy update. If we're creating the access policy than
 * `oldAccessPolicy` will be null. Starts by running `validateAccessPolicyUpdate()`
 * which is the same check run by the client optimistically when the access policy
 * changes to show the user an error.
 */
export async function validateAccessPolicyUpdateForServer(
    context: ServerMinimalAccountActionContext,
    spaceId: SpaceId,
    oldAccessPolicy: AccessPolicy | null,
    newAccessPolicy: AccessPolicy,
    options?: {consistency?: DynamoCacheReadConsistency},
) {
    if (context.actor.type === "Bot" && oldAccessPolicy !== null) {
        // NOTE(ifitzsimmons, #ai): There's no system limitation that prevents bots from
        // updating access policies we simply just haven't built this capability yet. As of
        // writing (2026-01-29) bots cannot update content (aside from stream parts in a
        // message).
        throw new PermissionDeniedError("Bots can’t update access policies");
    }

    if (oldAccessPolicy === null) {
        if (!(await evaluateAccessPolicy(context, spaceId, newAccessPolicy, "Manage", options))) {
            throw new InvalidArgumentError(
                "Account actor must have `Manage` access level on anything they create",
            );
        }
    } else {
        assert(context.actor.type !== "Bot");

        const result = validateAccessPolicyUpdate(
            context.actor.getAccountId(),
            oldAccessPolicy,
            newAccessPolicy,
        );
        if (!result.ok) {
            throw new FailedPreconditionError(result.reason);
        }
    }

    await runAllPromises(
        mapIterable(newAccessPolicy.accountGrantById.keys(), async accountId => {
            if (oldAccessPolicy?.accountGrantById.has(accountId)) return;

            // Can't share with bot accounts. Bot accounts aren't granted access through direct
            // sharing. Instead when you mention a bot they get access to whatever you
            // mentioned the bot on for a short period of time.
            if (await isBotSpaceAccount(context, spaceId, accountId)) {
                throw new PermissionDeniedError("Can\u2019t grant access to a bot account");
            }
        }),
    );
}
