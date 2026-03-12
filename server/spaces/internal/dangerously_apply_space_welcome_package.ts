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
    }: {
        accountId: AccountId;
        welcomePackageItem: SpaceWelcomePackageItem;
        suggestedAccountIds: ReadonlyArray<AccountId>;
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
            points: getPoints(),
        }),
        context.searchInjection.dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization({
            spaceId,
            accountId,
            entityId: `Channel:${randomChannelId}`,
            points: getPoints(),
        }),
        chatGptBotAccountId
            ? context.searchInjection.dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization({
                  spaceId,
                  accountId,
                  entityId: `Account:${chatGptBotAccountId}`,
                  points: getPoints(),
              })
            : null,
        cursorBotAccountId
            ? context.searchInjection.dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization({
                  spaceId,
                  accountId,
                  entityId: `Account:${cursorBotAccountId}`,
                  points: getPoints(),
              })
            : null,
        ...suggestedAccountIds.slice(0, suggestedSpaceAccountMaxCount).map(suggestedAccountId =>
            context.searchInjection.dangerouslyAddSearchAffinityEntityPointsWithoutAuthorization({
                spaceId,
                accountId,
                entityId: `Account:${suggestedAccountId}`,
                points: getPoints(),
            }),
        ),
    ]);
}
