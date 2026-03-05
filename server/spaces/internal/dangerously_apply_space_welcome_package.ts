import {ServerActionContextModules} from "~/server/context/server_action_context.js";
import {suggestedSpaceAccountMaxCount} from "~/server/spaces/dangerously_expensively_get_suggested_space_account_ids_without_authorization.js";
import {SpaceWelcomePackageItem} from "~/server/spaces/internal/spaces_table.js";
import {searchAffinityEntityHighIntentUpdateInteractionPoints} from "~/server/spaces/search_affinity_entity_interaction_points.js";
import {Context} from "~/shared/context/context.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId} from "~/shared/id/types/id_types.js";

export const internalSpaceWelcomePackageSearchEntityMaxCount =
    1 + // My tasks
    1 + // General channel
    1 + // Random channel
    1 + // ChatGPT
    suggestedSpaceAccountMaxCount;

/**
 * Add affinity points for an `AccountId` based on a space's welcome package.
 */
export async function dangerouslyApplySpaceWelcomePackage(
    context: Context<Omit<ServerActionContextModules, "actor">>,
    {
        accountId,
        welcomePackageItem: {spaceId, generalChannelId, randomChannelId, chatGptBotAccountId},
        suggestedAccountIds,
    }: {
        accountId: AccountId;
        welcomePackageItem: SpaceWelcomePackageItem;
        suggestedAccountIds: ReadonlyArray<AccountId>;
    },
) {
    const increment = 0.001;

    await runAllPromises([
        context.searchInjection.dangerouslyFavoriteSearchEntityWithoutAuthorization({
            spaceId,
            accountId,
            entityId: "TaskPersonal",
        }),
        context.searchInjection.dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization({
            spaceId,
            accountId,
            entityId: `Channel:${generalChannelId}`,
            points: searchAffinityEntityHighIntentUpdateInteractionPoints - increment * 0,
        }),
        context.searchInjection.dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization({
            spaceId,
            accountId,
            entityId: `Channel:${randomChannelId}`,
            points: searchAffinityEntityHighIntentUpdateInteractionPoints - increment * 1,
        }),
        chatGptBotAccountId
            ? context.searchInjection.dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization({
                  spaceId,
                  accountId,
                  entityId: `Account:${chatGptBotAccountId}`,
                  points: searchAffinityEntityHighIntentUpdateInteractionPoints - increment * 2,
              })
            : null,
        ...suggestedAccountIds
            .slice(0, suggestedSpaceAccountMaxCount)
            .map((suggestedAccountId, index) =>
                context.searchInjection.dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization(
                    {
                        spaceId,
                        accountId,
                        entityId: `Account:${suggestedAccountId}`,
                        points:
                            searchAffinityEntityHighIntentUpdateInteractionPoints -
                            increment * (3 + index),
                    },
                ),
            ),
    ]);
}
