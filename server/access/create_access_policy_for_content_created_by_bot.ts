import {getBotAccessPolicy} from "~/server/access/get_bot_access_policy.js";
import {ServerBotActionContext} from "~/server/context/server_action_context.js";
import {DynamoCacheReadConsistency} from "~/server/dynamo/core/dynamo_read_consistency.js";
import {isAccountMemberOfSpace} from "~/server/spaces/is_account_member_of_space.js";
import {isBotSpaceAccount} from "~/server/spaces/is_bot_space_account.js";
import {AccessPolicy, AccessPolicyAccountGrant} from "~/shared/access/access_policy.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {isNonNullable} from "~/shared/helpers/control/is_non_nullable.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

export async function createAccessPolicyForContentCreatedByBot(
    context: ServerBotActionContext,
    spaceId: SpaceId,
    options?: {consistency?: DynamoCacheReadConsistency},
): Promise<AccessPolicy> {
    const botAccessPolicy = await getBotAccessPolicy(context, options);

    const humanAccountIdsWithAccess = (
        await runAllPromises(
            botAccessPolicy.accountGrantById.keys().map(async accountId => {
                // it's possible that someone in the bot's scope was removed from the space.
                // if/when they're added back to the space, they shouldn't have access to the
                // content by default, right?
                const isMember = await isAccountMemberOfSpace(context, spaceId, accountId);
                if (!isMember) return null;

                // Bots should not be added directly to an access policy. They have access to
                // content based on their current scope. As soon as the bot creates the content
                // within a given scope, it'll be able to read that content back from that scope.
                // When asked to update the content, it will only be able to do so if the request
                // is coming from a scope that also has access to the document.
                //
                // I think this is right. This prevents a bad actor who doesn't have access to the
                // content from being able to read it through the access policy.
                const isBot = await isBotSpaceAccount(context, spaceId, accountId);
                if (isBot) return null;

                return accountId;
            }),
        )
    ).filter(isNonNullable);

    // NOTE(ifitzsimmons: 2026-01-15) this escalates every user in the scope to
    // "Manage" access. This also feels correct.
    //
    // For example, let's say Alice, Bob, and Charlie are all in a conversation with a
    // bot. If Bob and Charlie are comment-only, and Alice asks the bot to create a new
    // document that summarizes the discussion, all three should be able to manage that
    // document. This may evolve over time, and maybe we don't use "Manage" access for
    // all content. Maybe Posts, for instance, can only be managed by the creator (the
    // person who requested the bot to do something).
    const accountGrantsByIdForHumansWithAccess = new Map<AccountId, AccessPolicyAccountGrant>(
        humanAccountIdsWithAccess.map(accountId => [accountId, {level: "Manage", generation: 0}]),
    );

    // Add generation to defaultGrant if it's "Manage" level (required by AccessPolicy
    // schema)
    const defaultGrant = botAccessPolicy.defaultGrant
        ? botAccessPolicy.defaultGrant.level === "Manage"
            ? {level: "Manage" as const, generation: 0}
            : botAccessPolicy.defaultGrant
        : null;

    return {
        accountGrantById: accountGrantsByIdForHumansWithAccess,
        defaultGrant,
        urlGrant: null,
    };
}
