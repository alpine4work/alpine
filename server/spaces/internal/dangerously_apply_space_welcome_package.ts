import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {suggestedSpaceAccountMaxCount} from "~/server/spaces/dangerously_expensively_get_suggested_space_account_ids_without_authorization.js";
import {SpaceWelcomePackageItem} from "~/server/spaces/internal/spaces_table.js";
import {searchAffinityEntityHighIntentUpdateInteractionPoints} from "~/server/spaces/search_affinity_entity_interaction_points.js";
import {Context} from "~/shared/context/context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";

export const internalSpaceWelcomePackageSearchEntityMaxCount =
    1 + // My tasks
    1 + // General channel
    1 + // Random channel
    1 + // ChatGPT
    1 + // Cursor
    suggestedSpaceAccountMaxCount;

/**
 * Add affinity points for an `AccountId` based on a space's welcome package.
 */
export async function dangerouslyApplySpaceWelcomePackage(
    context: Context<Omit<ServerActionContextModules, "actor">>,
    {
        accountId,
        welcomePackageItem: {
            spaceId,
            generalChannelId,
            randomChannelId,
            chatGptBotAccountId,
            cursorBotAccountId,
        },
        suggestedAccountIds,
        invitedAccountIds,
    }: {
        accountId: AccountId;
        welcomePackageItem: SpaceWelcomePackageItem;
        suggestedAccountIds: Iterable<AccountId>;
        invitedAccountIds: Iterable<AccountId>;
    },
) {
    const increment = 0.001;
    let incrementMultiplier = 0;

    function getPoints() {
        const points =
            searchAffinityEntityHighIntentUpdateInteractionPoints - increment * incrementMultiplier;
        incrementMultiplier += 1;
        return points;
    }

    const promises: Array<Promise<unknown>> = [];

    promises.push(
        context.searchInjection.dangerouslyFavoriteSearchEntityWithoutAuthorization({
            spaceId,
            accountId,
            entityId: "TaskPersonal",
        }),
    );

    promises.push(
        context.searchInjection.dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization({
            spaceId,
            accountId,
            entityId: `Channel:${generalChannelId}`,
            points: getPoints(),
        }),
    );

    promises.push(
        context.searchInjection.dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization({
            spaceId,
            accountId,
            entityId: `Channel:${randomChannelId}`,
            points: getPoints(),
        }),
    );

    let remainingSuggestedAccountCount = suggestedSpaceAccountMaxCount;

    // Put any users you invite in your feed sidebar. Otherwise add some suggested
    // accounts to your feed sidebar (if available).
    for (const invitedOrSuggestedAccountId of new Set(
        concatIterables(invitedAccountIds, suggestedAccountIds),
    )) {
        if (remainingSuggestedAccountCount <= 0) break;
        remainingSuggestedAccountCount--;

        promises.push(
            context.searchInjection.dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization({
                spaceId,
                accountId,
                entityId: `Account:${invitedOrSuggestedAccountId}`,
                points: getPoints(),
            }),
        );
    }

    if (chatGptBotAccountId) {
        promises.push(
            context.searchInjection.dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization({
                spaceId,
                accountId,
                entityId: `Account:${chatGptBotAccountId}`,
                points: getPoints(),
            }),
        );
    }

    if (cursorBotAccountId) {
        promises.push(
            context.searchInjection.dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization({
                spaceId,
                accountId,
                entityId: `Account:${cursorBotAccountId}`,
                points: getPoints(),
            }),
        );
    }

    await runAllPromises(promises);
}
