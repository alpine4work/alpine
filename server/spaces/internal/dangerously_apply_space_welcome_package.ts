import {ServerActionContext} from "~/server/context/server_action_context.js";
import {SpaceWelcomePackageItem} from "~/server/spaces/internal/spaces_table.js";
import {searchAffinityEntityHighIntentUpdateInteractionPoints} from "~/server/spaces/search_affinity_entity_interaction_points.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId} from "~/shared/id/types/id_types.js";

/**
 * Add affinity points for an `AccountId` based on a space's welcome package.
 */
export async function dangerouslyApplySpaceWelcomePackage(
    context: ServerActionContext,
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
        ...suggestedAccountIds.map((suggestedAccountId, index) =>
            context.searchInjection.dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization({
                spaceId,
                accountId,
                entityId: `Account:${suggestedAccountId}`,
                points:
                    searchAffinityEntityHighIntentUpdateInteractionPoints - increment * (3 + index),
            }),
        ),
    ]);
}
