import {Node} from "prosemirror-model";
import {intoApiContent} from "~/server/api/internal/shared/into_api_content.js";
import {ServerAccountActionContext} from "~/server/context/server_action_context.js";
import {getAccount} from "~/server/spaces/spaces_actions.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {missingAccountName} from "~/shared/accounts/missing_account_name.js";
import {ApiContent} from "~/shared/api/types/api_specification_convenience_types.js";
import {getContentReferencedIdsForNode} from "~/shared/content/content_referenced_ids.js";
import {truncateContentMentionText} from "~/shared/content/truncate_content_mention_text.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {getSearchEntityNoun} from "~/shared/search/get_search_entity_noun.js";
import {
    deletedSearchEntityTitle,
    missingSearchEntityTitle,
    privateSearchEntityTitle,
} from "~/shared/search/missing_and_private_search_entity_titles.js";
import {parseSearchMentionEntityId} from "~/shared/search/search_entity_id.js";

export async function intoApiContentWithReferences(
    context: ServerAccountActionContext,
    spaceId: SpaceId,
    node: Node,
): Promise<ApiContent> {
    // Content references are loaded with eventual consistency. We clearly
    // document this for public API users.
    const referencesContext = context.dynamo.unexpectStrongReadConsistency();

    const referencedIds = getContentReferencedIdsForNode(node);

    const [accounts, searchEntityEntries] = await runAllPromises([
        runAllPromises(
            mapIterable(referencedIds.accountIds, accountId =>
                getAccount(referencesContext, spaceId, accountId),
            ),
        ),
        runAllPromises(
            mapIterable(referencedIds.searchEntityIds, async entityId => {
                const entityResult =
                    await referencesContext.searchInjection.getSearchMentionEntityIfPossible(
                        spaceId,
                        entityId,
                    );
                return [entityId, entityResult] as const;
            }),
        ),
    ]);

    const accountById = new Map(accounts.map(account => [account.id, account]));
    const searchEntityById = new Map(searchEntityEntries);

    return intoApiContent(node, {
        getAccountMentionTitleIfExists: (accountId, {isShort}) => {
            const account = accountById.get(accountId);
            if (!account) return missingAccountName;
            if (!isShort) return account.initialData.name;
            return getAccountShortNameWithoutFullNameTooltip(account.initialData);
        },
        getSearchEntityMentionTitleIfExists: entityId => {
            const entityResult = searchEntityById.get(entityId);

            if (!entityResult) {
                const {type} = parseSearchMentionEntityId(entityId);
                return `${missingSearchEntityTitle} ${getSearchEntityNoun(type)}`;
            }

            if (entityResult.isPrivate) {
                const {type} = parseSearchMentionEntityId(entityId);
                return `${privateSearchEntityTitle} ${getSearchEntityNoun(type)}`;
            }

            const entity = entityResult.entity.initialData;

            // If `title` is null then we assume the entity was deleted. Otherwise, all
            // mentionable entities should have a non-null title.
            if (entity.title === null) {
                const {type} = parseSearchMentionEntityId(entityId);
                return `${deletedSearchEntityTitle} ${getSearchEntityNoun(type)}`;
            }

            let entityTitle = truncateContentMentionText(entity.title);

            if (entityTitle.length === 0) {
                const {type} = parseSearchMentionEntityId(entityId);
                return `${missingSearchEntityTitle} ${getSearchEntityNoun(type)}`;
            }

            // Posts start with "in ${channelName}: " and expect client rendering code to
            // add the post author name to the start of the title.
            if (entity.media?.type === "Account" && entityId.startsWith("Post:")) {
                entityTitle = `${getAccountShortNameWithoutFullNameTooltip(
                    entity.media.account.initialData,
                )} ${entityTitle}`;
            }

            return entityTitle;
        },
    });
}
