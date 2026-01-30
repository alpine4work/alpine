import {evaluateAccessPolicy} from "~/server/access/evaluate_access_policy.js";
import {ServerSessionActionContext} from "~/server/context/server_action_context.js";
import {isBotSpaceAccount} from "~/server/spaces/is_bot_space_account.js";
import {AccessPolicy, validateAccessPolicyUpdate} from "~/shared/access/access_policy.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Validates an access policy update. If we're creating the access policy than
 * `oldAccessPolicy` will be null. Starts by running
 * `validateAccessPolicyUpdate()` which is the same check run by the client
 * optimistically when the access policy changes to show the user an error.
 */
export async function validateAccessPolicyUpdateForServer(
    context: ServerSessionActionContext,
    spaceId: SpaceId,
    oldAccessPolicy: AccessPolicy | null,
    newAccessPolicy: AccessPolicy,
) {
    if (oldAccessPolicy === null) {
        if (!(await evaluateAccessPolicy(context, spaceId, newAccessPolicy, "Manage"))) {
            throw new InvalidArgumentError(
                "Account actor must have `Manage` access level on anything they create",
            );
        }
    } else {
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

            // Can't share with bot accounts. Bot accounts aren't granted access through
            // direct sharing. Instead when you mention a bot they get access to whatever
            // you mentioned the bot on for a short period of time.
            if (await isBotSpaceAccount(context, spaceId, accountId)) {
                throw new PermissionDeniedError("Can\u2019t grant access to a bot account");
            }
        }),
    );
}
