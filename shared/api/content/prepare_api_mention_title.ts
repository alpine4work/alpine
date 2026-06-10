import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {truncateContentMentionText} from "~/shared/content/truncate_content_mention_text.js";
import {getSearchEntityNoun} from "~/shared/search/get_search_entity_noun.js";
import {
    deletedSearchEntityTitle,
    missingSearchEntityTitle,
} from "~/shared/search/missing_and_private_search_entity_titles.js";
import {
    SearchMentionEntityId,
    parseSearchMentionEntityId,
} from "~/shared/search/search_entity_id.js";
import {SearchEntityModelData} from "~/shared/search/search_entity_model.js";
import {AccountModel, AccountModelData} from "~/shared/spaces/account_model.js";

export function prepareApiMentionTitle(
    entityId: SearchMentionEntityId,
    entity: SearchEntityModelData | {type: "Account"; title: string},
    getAccountSnapshot: (account: AccountModel) => AccountModelData,
) {
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

    // Posts start with "in ${channelName}: " and expect client rendering code to add
    // the post author name to the start of the title.
    if (entity.type === "Post") {
        entityTitle = `${getAccountShortNameWithoutFullNameTooltip(
            getAccountSnapshot(entity.post.author),
        )} ${entityTitle}`;
    }

    return entityTitle;
}
