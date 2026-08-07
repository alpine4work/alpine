import {getBotAccessPolicy} from "~/server/access/get_bot_access_policy.js";
import {intoEffectiveAccessPolicy} from "~/server/access/into_effective_access_policy.js";
import {ServerBotActionContext} from "~/server/context/server_action_context.js";
import {ServerMinimalActionContext} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {
    isAccountMemberOfSpace,
    isAccountMemberOfSpaceWithoutAuthorization,
} from "~/server/spaces/is_account_member_of_space.js";
import {isBotSpaceAccount} from "~/server/spaces/is_bot_space_account.js";
import {
    AccessLevel,
    AccessPolicy,
    AccessPolicyUrlGrant,
    EffectiveAccessPolicy,
    ResolvedAccessPolicy,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.open_source.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

/**
 * Evaluates whether the `AccountId` has access to the access policy at the
 * provided access level.
 *
 * Returns true if the account has access.
 */
export async function evaluateAccessPolicy(
    context: ServerMinimalActionContext,
    spaceId: SpaceId,
    rawAccessPolicy: AccessPolicy | ResolvedAccessPolicy | EffectiveAccessPolicy,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<boolean> {
    // Inform the discovery context module about the `SpaceId` for this access policy
    // we're evaluating. In `AppService` this will start loading space data for the
    // space chrome.
    context.discovery?.discoverSpaceId(spaceId, "AuthorizeAccess");

    const accessPolicy = isAccessPolicyOrResolvedAccessPolicy(rawAccessPolicy)
        ? await intoEffectiveAccessPolicy(context, rawAccessPolicy, options)
        : rawAccessPolicy;

    switch (context.actor.type) {
        // Anonymous users ONLY get access through `urlGrant`.
        case "Anonymous": {
            // If there's a `urlGrant` then everyone has access at this level. Even when
            // `accountId` is null or `accountId` does not have space access.
            if (
                accessPolicy.urlGrant !== null &&
                hasAccessLevel(accessPolicy.urlGrant.level, expectedAccessLevel)
            ) {
                return true;
            }

            return false;
        }

        case "System": {
            // If there's a `urlGrant` then everyone has access at this level. Even when
            // `accountId` is null or `accountId` does not have space access.
            if (
                accessPolicy.urlGrant !== null &&
                hasAccessLevel(accessPolicy.urlGrant.level, expectedAccessLevel)
            ) {
                return true;
            }

            return spaceId === context.actor.getSpaceId();
        }
        case "Session":
        case "ImpersonatedAccount": {
            // If there's a `urlGrant` then everyone has access at this level. Even when
            // `accountId` is null or `accountId` does not have space access.
            if (
                accessPolicy.urlGrant !== null &&
                hasAccessLevel(accessPolicy.urlGrant.level, expectedAccessLevel)
            ) {
                return true;
            }

            if (
                context.actor.type === "ImpersonatedAccount" &&
                spaceId !== context.actor.getSpaceId()
            ) {
                return false;
            }

            return await evaluateAccessPolicyForAccount(
                context,
                spaceId,
                context.actor.getAccountId(),
                accessPolicy,
                expectedAccessLevel,
            );
        }
        case "Bot": {
            // If there's a `urlGrant` then everyone has access at this level. Even when
            // `accountId` is null or `accountId` does not have space access.
            if (
                accessPolicy.urlGrant !== null &&
                hasAccessLevel(accessPolicy.urlGrant.level, expectedAccessLevel)
            ) {
                return true;
            }

            // If this account is not a space member they can't have access.
            //
            // Even if an account was previously a member, was removed, but is still listed in
            // the `AccessPolicy` they can't access. An account can only access the resource if
            // they're an active space member.
            if (
                !(await isAccountMemberOfSpaceWithoutAuthorization(
                    context,
                    spaceId,
                    context.actor.getBotAccountId(),
                ))
            ) {
                return false;
            }

            // Do we grant access to everyone in the space?
            if (
                accessPolicy.defaultGrant !== null &&
                hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)
            ) {
                return true;
            }

            // NOTE(calebmer): There's a massive vulnerability here if `urlGrant`ed actors get
            // the ability to ask bots for information. Bots have access to anything that
            // everyone in their scope has access to. However, right now we only check to make
            // sure every space account in the scope has access!
            //
            // So if a `urlGrant`ed actor that's not a space account (e.g. an anonymous actor)
            // mentions "@ChatGPT find me such and such document" we'll happily comply and
            // return them any document that has a `defaultGrant` (is public in the space).
            //
            // This `assertEqualTypes()` will throw a TypeScript error if
            // `AccessPolicyUrlGrant` is ever expanded to include `AccessLevel`s other than
            // `View`. If we can grant `Comment` access to `urlGrant`ed actors then we need to
            // seriously reconsider bot permissions on a shared entity.
            assertEqualTypes<AccessPolicyUrlGrant["level"], "View">();

            const botAccessPolicy = await getBotAccessPolicy(
                context as ServerBotActionContext,
                options,
            );

            // If the bot's scope is everyone in the space and we didn't have
            // `accessPolicy.defaultGrant` earlier then the bot can't read this private entity.
            if (botAccessPolicy.defaultGrant !== null) return false;

            // If the scoped entity has a `urlGrant`, the bot may be used in URL-sharing or
            // anonymous-adjacent flows. It must not read other private resources. We return
            // false unconditionally here because:
            //
            // - URL grants only ever grant `View` access (enforced by the
            //   `assertEqualTypes<AccessPolicyUrlGrant["level"], "View">()` above).
            // - The early `accessPolicy.urlGrant` check above already returns `true` for any
            //   case where the target's own URL grant satisfies `expectedAccessLevel`.
            //
            // So by the time we reach here, the bot's URL-grant scope can't legitimately
            // unlock access at the requested level.
            if (botAccessPolicy.urlGrant !== null) return false;

            let hasSomeAccountWithAccess = false;
            const accountIdsWithoutAccessBeforeMembershipCheck: Array<AccountId> = [];

            for (const accountId of botAccessPolicy.accountGrantById.keys()) {
                const accountGrant = accessPolicy.accountGrantById.get(accountId);
                if (accountGrant && hasAccessLevel(accountGrant.level, expectedAccessLevel)) {
                    hasSomeAccountWithAccess = true;
                } else {
                    // Minor optimization: We filter out bots from
                    // `accountIdsWithoutAccessBeforeMembershipCheck`. If this is our bot actor then we
                    // already know it's a bot and can ignore it without a database request.
                    if (accountId === context.actor.getBotAccountId()) continue;

                    accountIdsWithoutAccessBeforeMembershipCheck.push(accountId);
                }
            }

            const accountIdsWithoutAccess = (
                await runAllPromises(
                    accountIdsWithoutAccessBeforeMembershipCheck.map(async accountId => {
                        // If the account isn't a member of the space anymore, then it's fine if the
                        // account doesn't have access to this entity.
                        const isMember = await isAccountMemberOfSpace(context, spaceId, accountId);
                        if (!isMember) return null;

                        // If the account is a bot then it's fine if the bot doesn't have access to this
                        // entity. Bots don't gain access through `AccessPolicy`, instead bots get access
                        // based on some scope they're running in.
                        const isBot = await isBotSpaceAccount(context, spaceId, accountId);
                        if (isBot) return null;

                        return accountId;
                    }),
                )
            ).filter(isNonNullable);

            // If the bot scope had ANY accounts that don't have access to this entity then we
            // don't grant the bot access to the entity.
            //
            // We make an exception for removed space accounts. If an account was a member of
            // the space, added to an access policy, then removed from the space it's unlikely
            // that account will be added to any new access policies (despite being in some old
            // access policies).
            if (accountIdsWithoutAccess.length > 0) return false;

            // If there wasn't at least one account with access then we don't grant the bot
            // access. This defends against bots getting really broad access when using a scope
            // with an `accountGrantById` that's empty (or that has only removed accounts).
            if (!hasSomeAccountWithAccess) return false;

            // We checked all `accountGrantById`s. The bot has access.
            return true;
        }
        default:
            throw exhaustive(context.actor);
    }
}

export async function evaluateAccessPolicyForAccount(
    context: ServerMinimalActionContext,
    spaceId: SpaceId,
    accountId: AccountId,
    rawAccessPolicy: AccessPolicy | ResolvedAccessPolicy | EffectiveAccessPolicy,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<boolean> {
    const accessPolicy = isAccessPolicyOrResolvedAccessPolicy(rawAccessPolicy)
        ? await intoEffectiveAccessPolicy(context, rawAccessPolicy, options)
        : rawAccessPolicy;

    // If there's a `urlGrant` then everyone has access at this level. Even when
    // `accountId` is null or `accountId` does not have space access.
    if (
        accessPolicy.urlGrant !== null &&
        hasAccessLevel(accessPolicy.urlGrant.level, expectedAccessLevel)
    ) {
        return true;
    }

    // Do we grant access to everyone in the space?
    if (
        accessPolicy.defaultGrant !== null &&
        hasAccessLevel(accessPolicy.defaultGrant.level, expectedAccessLevel)
    ) {
        // If this account is not a space member they can't have access.
        //
        // Even if an account was previously a member, was removed, but is still listed in
        // the `AccessPolicy` they can't access. An account can only access the resource if
        // they're an active space member.
        //
        // Optimization: Only run if there's a `defaultGrant`. Otherwise we can return
        // false without making a database call.
        if (!(await isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId))) {
            return false;
        }

        return true;
    }

    // Do we grant access to this account?
    const accountGrant = accessPolicy.accountGrantById.get(accountId);
    if (accountGrant && hasAccessLevel(accountGrant.level, expectedAccessLevel)) {
        // If this account is not a space member they can't have access.
        //
        // Even if an account was previously a member, was removed, but is still listed in
        // the `AccessPolicy` they can't access. An account can only access the resource if
        // they're an active space member.
        //
        // Optimization: Only run if there's an `accountGrant` for our actor. Otherwise we
        // can return false without making a database call.
        if (!(await isAccountMemberOfSpaceWithoutAuthorization(context, spaceId, accountId))) {
            return false;
        }

        return true;
    }

    return false;
}

function isAccessPolicyOrResolvedAccessPolicy(
    accessPolicy: AccessPolicy | ResolvedAccessPolicy | EffectiveAccessPolicy,
): accessPolicy is AccessPolicy | ResolvedAccessPolicy {
    return "type" in accessPolicy;
}
