import {evaluateAccessPolicy} from "~/server/access/evaluate_access_policy.js";
import {ServerMinimalAccountActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {isBotSpaceAccount} from "~/server/spaces/is_bot_space_account.js";
import {
    AccessPolicy,
    ResolvedAccessPolicy,
    ResolvedAccessPolicyWithGenerations,
    isSiteRelatedAccessPolicyUpdate,
    validateAccessPolicyUpdate,
} from "~/shared/access/access_policy.js";
import {createAggregateError} from "~/shared/error/aggregate_error.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    PermissionDeniedError,
} from "~/shared/error/error.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
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
): Promise<ResolvedAccessPolicy> {
    // The user is allowed to add to a site, remove from a site, or move to a different
    // site if they have Manage access on the new and old access policies. We
    // denormalize the access policies up front and then validate the permissions on
    // the old and new access policies.
    const [oldResolvedAccessPolicy, newResolvedAccessPolicy]: [
        ResolvedAccessPolicyWithGenerations | null,
        ResolvedAccessPolicyWithGenerations,
    ] = await runAllPromises([
        oldAccessPolicy ? getResolvedAccessPolicy(context, oldAccessPolicy, options) : null,
        getResolvedAccessPolicy(context, newAccessPolicy, options),
    ]);

    await runAllPromises([
        validateSiteManageAccessIfNeeded(
            context,
            spaceId,
            oldResolvedAccessPolicy,
            newResolvedAccessPolicy,
            options,
        ),
        validateResolvedAccessPolicyUpdateForServer(
            context,
            spaceId,
            oldResolvedAccessPolicy,
            newResolvedAccessPolicy,
            options,
        ),
    ]);

    return newResolvedAccessPolicy;
}

async function validateResolvedAccessPolicyUpdateForServer(
    context: ServerMinimalAccountActionContext,
    spaceId: SpaceId,
    oldAccessPolicy: ResolvedAccessPolicyWithGenerations | null,
    newAccessPolicy: ResolvedAccessPolicyWithGenerations,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<ResolvedAccessPolicy> {
    if (context.actor.type === "Bot" && oldAccessPolicy !== null) {
        // NOTE(ifitzsimmons, #ai): There's no system limitation that prevents bots from
        // updating access policies we simply just haven't built this capability yet. As of
        // writing (2026-01-29) bots cannot update content (aside from stream parts in a
        // message).
        throw new PermissionDeniedError("Bots can\u2019t update access policies");
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

    // If the new policy explicity grants access to a bot, throw an error. Bot accounts
    // aren't granted access through direct sharing. Instead when you mention a bot
    // they get access to whatever you mentioned the bot on for a short period of time.
    await runAllPromises(
        mapIterable(newAccessPolicy.accountGrantById.keys(), async accountId => {
            if (oldAccessPolicy?.accountGrantById.has(accountId)) return;

            if (await isBotSpaceAccount(context, spaceId, accountId)) {
                throw new PermissionDeniedError("Can\u2019t grant access to a bot account");
            }
        }),
    );

    return newAccessPolicy;
}

async function getResolvedAccessPolicy(
    context: ServerMinimalAccountActionContext,
    accessPolicy: AccessPolicy,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<ResolvedAccessPolicyWithGenerations> {
    switch (accessPolicy.type) {
        case "Local": {
            return accessPolicy;
        }
        case "Site": {
            const siteAccessPolicy =
                await context.sitesInjection.dangerouslyGetSiteAccessPolicyWithoutAuthorization(
                    accessPolicy.siteId,
                    options,
                );

            return {...siteAccessPolicy, type: "Site", siteId: accessPolicy.siteId};
        }
        default:
            throw exhaustive(accessPolicy);
    }
}

async function validateSiteManageAccessIfNeeded(
    context: ServerMinimalAccountActionContext,
    spaceId: SpaceId,
    oldAccessPolicy: ResolvedAccessPolicyWithGenerations | null,
    newAccessPolicy: ResolvedAccessPolicyWithGenerations,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<void> {
    // When adding to, removing from, or changing sites, we need to validate that the
    // actor has Manage access in the new policy. If this is not a site-related policy
    // update, we can return early.
    if (!isSiteRelatedAccessPolicyUpdate(oldAccessPolicy, newAccessPolicy)) return;

    const [oldIsAccessAuthorized, newIsAccessAuthorized] = await runAllPromises([
        oldAccessPolicy?.type === "Site"
            ? evaluateAccessPolicy(context, spaceId, oldAccessPolicy, "Manage", options)
            : true,
        newAccessPolicy.type === "Site"
            ? evaluateAccessPolicy(context, spaceId, newAccessPolicy, "Manage", options)
            : true,
    ]);

    const errors = [];
    if (!oldIsAccessAuthorized) {
        errors.push(
            new PermissionDeniedError(
                "Actor doesn\u2019t have `Manage` access on old access policy",
            ),
        );
    }
    if (!newIsAccessAuthorized) {
        errors.push(
            new PermissionDeniedError(
                "Actor doesn\u2019t have `Manage` access on new access policy",
            ),
        );
    }

    if (errors.length === 1) throw errors[0];
    if (errors.length > 1) throw createAggregateError(errors);

    return;
}
