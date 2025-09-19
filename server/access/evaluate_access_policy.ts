import {ServerBotActionContext} from "~/server/context/server_action_context.js";
import {
    ServerMinimalActionContext,
    ServerMinimalBotActionContext,
} from "~/server/context/server_minimal_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {
    isAccountMemberOfSpace,
    isAccountMemberOfSpaceWithoutAuthorization,
    isBotSpaceAccount,
} from "~/server/spaces/spaces_table.js";
import {
    AccessLevel,
    AccessPolicyUrlGrant,
    AccessPolicyWithoutGenerations,
    hasAccessLevel,
} from "~/shared/access/access_policy.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {emptyMap} from "~/shared/helpers/map/empty_map.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Evaluates whether the `AccountId` has access to the access policy at
 * the provided access level.
 *
 * Returns true if the account has access.
 */
export async function evaluateAccessPolicy(
    context: ServerMinimalActionContext,
    spaceId: SpaceId,
    accessPolicy: AccessPolicyWithoutGenerations,
    expectedAccessLevel: AccessLevel,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<boolean> {
    // If there's a `urlGrant` then everyone has access at this level. Even when
    // `accountId` is null or `accountId` does not have space access.
    if (
        accessPolicy.urlGrant !== null &&
        hasAccessLevel(accessPolicy.urlGrant.level, expectedAccessLevel)
    ) {
        return true;
    }

    switch (context.actor.type) {
        // Anonymous users ONLY get access through `urlGrant`.
        case "Anonymous":
            return false;

        case "System": {
            return spaceId === context.actor.getSpaceId();
        }
        case "Session":
        case "ImpersonatedAccount": {
            if (
                context.actor.type === "ImpersonatedAccount" &&
                spaceId !== context.actor.getSpaceId()
            ) {
                return false;
            }

            // If this account is not a space member they can't have access.
            //
            // Even if an account was previously a member, was removed, but is still listed
            // in the `AccessPolicy` they can't access. An account can only access the
            // resource if they're an active space member.
            if (
                !(await isAccountMemberOfSpaceWithoutAuthorization(
                    context,
                    spaceId,
                    context.actor.getAccountId(),
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

            // Do we grant access to this account?
            const accountGrant = accessPolicy.accountGrantById.get(context.actor.getAccountId());
            if (accountGrant && hasAccessLevel(accountGrant.level, expectedAccessLevel)) {
                return true;
            }

            return false;
        }
        case "Bot": {
            // If this account is not a space member they can't have access.
            //
            // Even if an account was previously a member, was removed, but is still listed
            // in the `AccessPolicy` they can't access. An account can only access the
            // resource if they're an active space member.
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

            // NOTE(calebmer): There's a massive vulnerability here if `urlGrant`ed actors
            // get the ability to ask bots for information. Bots have access to anything
            // that everyone in their scope has access to. However, right now we only check
            // to make sure every space account in the scope has access!
            //
            // So if a `urlGrant`ed actor that's not a space account (e.g. an anonymous
            // actor) mentions "@ChatGPT find me such and such document" we'll happily
            // comply and return them any document that has a `defaultGrant` (is public in
            // the space).
            //
            // This `assertEqualTypes()` will throw a TypeScript error if
            // `AccessPolicyUrlGrant` is ever expanded to include `AccessLevel`s other than
            // `View`. If we can grant `Comment` access to `urlGrant`ed actors then we need
            // to seriously reconsider bot permissions on a shared entity.
            assertEqualTypes<AccessPolicyUrlGrant["level"], "View">();

            const botAccessPolicy = await getBotAccessPolicy(
                context as ServerBotActionContext,
                options,
            );

            // If the bot's scope is everyone in the space and we didn't have
            // `accessPolicy.defaultGrant` earlier then the bot can't read this private
            // entity.
            if (botAccessPolicy.defaultGrant !== null) return false;

            let hasSomeAccountWithAccess = false;
            const accountIdsWithoutAccessBeforeMembershipCheck: Array<AccountId> = [];

            for (const accountId of botAccessPolicy.accountGrantById.keys()) {
                const accountGrant = accessPolicy.accountGrantById.get(accountId);
                if (accountGrant && hasAccessLevel(accountGrant.level, expectedAccessLevel)) {
                    hasSomeAccountWithAccess = true;
                } else {
                    // Minor optimization: We filter out bots from
                    // `accountIdsWithoutAccessBeforeMembershipCheck`. If this is our bot actor then
                    // we already know it's a bot and can ignore it without a database request.
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

                        // If the account is a bot then it's fine if the bot doesn't have access to
                        // this entity. Bots don't gain access through `AccessPolicy`, instead bots get
                        // access based on some scope they're running in.
                        const isBot = await isBotSpaceAccount(context, spaceId, accountId);
                        if (isBot) return null;

                        return accountId;
                    }),
                )
            ).filter(isNonNullable);

            // If the bot scope had ANY accounts that don't have access to this entity then
            // we don't grant the bot access to the entity.
            //
            // We make an exception for removed space accounts. If an account was a member
            // of the space, added to an access policy, then removed from the space it's
            // unlikely that account will be added to any new access policies (despite
            // being in some old access policies).
            if (accountIdsWithoutAccess.length > 0) return false;

            // If there wasn't at least one account with access then we don't grant the bot
            // access. This defends against bots getting really broad access when using a
            // scope with an `accountGrantById` that's empty (or that has only removed
            // accounts).
            if (!hasSomeAccountWithAccess) return false;

            // We checked all `accountGrantById`s. The bot has access.
            return true;
        }
        default:
            throw exhaustive(context.actor);
    }
}

async function getBotAccessPolicy(
    context: ServerMinimalBotActionContext,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<AccessPolicyWithoutGenerations> {
    // The scope of access the bot has. For example, if you mention a bot from a
    // forum post then the bot's scope will be `Post` with the corresponding
    // `PostId`. If you mention a bot from a chat then the scope will be `Chat`
    // with the corresponding `ChatId`.
    //
    // A scope of `Space` means the bot only has access to content shared with
    // everyone in the space. A scope of `Account` means the bot only has access to
    // stuff that account has access to.
    //
    // All other entity scopes (e.g. `Chat`, `Document`, `Post`, etc.) means the
    // bot only has access to stuff that EVERYONE who has access to the entity has
    // access to. So if a `Chat` has Alice and Bob, the bot only has access to
    // stuff both Alice and Bob have access to. Bob can't ask the bot to read
    // Alice's private tasks! And we don't want the bot to accidentally leak Bob's
    // private tasks as it responds to Bob's mention.
    //
    // The order of most restrictive scope to least restrictive scope goes like
    // this:
    //
    // 1. `Space`: Most restrictive scope since it's only stuff shared with
    //    everyone in the space. Every other scope has access to this content
    //    too.
    //
    // 2. Entity scopes (e.g. `Chat`, `Document`, `Post`, etc.): Less restrictive
    //    than `Space` but more restrictive than `Account`. Since now the bot has
    //    access to some private stuff (if the entity isn't shared with everyone in
    //    the space) but not private stuff one account has access to but the other
    //    doesn't.
    //
    // 3. `Account`: Least restrictive scope since you have access to everything
    //    the `Account` has access to without any additional limits.
    //
    // There's an inverse relationship between the number of accounts used to
    // compute the bot's permissions and how restrictive the scope is. You can
    // think of this as the bot's permissions are the intersection the permission
    // set of all accounts that can view the scope. Intersection leads to smaller
    // permission sets.
    const scope = context.actor.getScope();

    switch (scope.type) {
        case "Space": {
            return {
                accountGrantById: emptyMap,
                defaultGrant: {level: "Manage"},
                urlGrant: null,
            };
        }
        case "Account": {
            return {
                accountGrantById: new Map([[scope.accountId, {level: "Manage"}]]),
                defaultGrant: null,
                urlGrant: null,
            };
        }
        case "Chat": {
            const accountIds = await context.chatInjection.getChatAccountIdsForBotScope(
                scope.chatId,
                options,
            );

            // Only accounts that are members of the chat have access to the chat. Create
            // an access policy that describes access as private to the chat's members. The
            // `AccessLevel` we pick doesn't really matter. There's nothing to edit at a
            // chat level right now (in the future we may let you create named chats and so
            // some people would be able to edit the chat name and others wouldn't).
            //
            // It's fine if bots are in this map. Even though normally you can't add bots
            // to an access policy. We'll filter out bots in `evaluateAccessPolicy()`.
            return {
                accountGrantById: new Map(
                    accountIds.map(accountId => [accountId, {level: "Edit"}]),
                ),
                defaultGrant: null,
                urlGrant: null,
            };
        }
        case "Document": {
            return context.documentsInjection.getDocumentAccessPolicyForBotScope(
                scope.documentId,
                options,
            );
        }
        case "Post": {
            return context.forumInjection.getPostAccessPolicyForBotScope(scope.postId, options);
        }
        case "Task": {
            return context.tasksInjection.getTaskAccessPolicyForBotScope(scope.taskId, options);
        }
        default:
            throw exhaustive(scope);
    }
}
