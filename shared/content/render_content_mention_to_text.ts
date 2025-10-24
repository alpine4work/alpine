import {AccountModelWithoutSpaceData} from "~/shared/accounts/account_model_without_space.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {missingAccountName} from "~/shared/accounts/missing_account_name.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {truncateContentMentionText} from "~/shared/content/truncate_content_mention_text.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {getSearchEntityNoun} from "~/shared/search/get_search_entity_noun.js";
import {
    deletedSearchEntityTitle,
    missingSearchEntityTitle,
    privateSearchEntityTitle,
} from "~/shared/search/missing_and_private_search_entity_titles.js";
import {
    SearchMentionEntityId,
    parseSearchMentionEntityId,
} from "~/shared/search/search_entity_id.js";

export type RenderContentMentionToTextSearchEntity =
    | {readonly isPrivate: true}
    | {
          readonly isPrivate: false;
          readonly title: string | null;
          readonly getAccountMediaShortName: (() => string) | null;
      };

export function renderContentMentionToText(
    mention: ContentMention,
    {
        getAccountIfExists,
        getSearchEntityIfExists,
    }: {
        getAccountIfExists: (
            accountId: AccountId,
        ) => Omit<AccountModelWithoutSpaceData, "avatar"> | null;
        getSearchEntityIfExists: (
            entityId: SearchMentionEntityId,
        ) => RenderContentMentionToTextSearchEntity | null;
    },
): string {
    switch (mention.type) {
        case "Account": {
            const account = getAccountIfExists(mention.accountId);
            if (!account) return missingAccountName;

            const accountName = mention.isShort
                ? getAccountShortNameWithoutFullNameTooltip(account)
                : account.name;

            return accountName;
        }
        case "SearchEntity": {
            const entity = getSearchEntityIfExists(mention.entityId);

            if (!entity) {
                const entityIdObject = parseSearchMentionEntityId(mention.entityId);
                return `${missingSearchEntityTitle} ${getSearchEntityNoun(entityIdObject.type)}`;
            }

            if (entity.isPrivate) {
                const entityIdObject = parseSearchMentionEntityId(mention.entityId);
                return `${privateSearchEntityTitle} ${getSearchEntityNoun(entityIdObject.type)}`;
            }

            // If `title` is null then we assume the entity was deleted. Otherwise, all
            // mentionable entities should have a non-null title.
            if (entity.title === null) {
                const entityIdObject = parseSearchMentionEntityId(mention.entityId);
                return `${deletedSearchEntityTitle} ${getSearchEntityNoun(entityIdObject.type)}`;
            }

            let entityTitle = truncateContentMentionText(entity.title);

            if (entityTitle.length === 0) {
                const entityIdObject = parseSearchMentionEntityId(mention.entityId);
                return `${missingSearchEntityTitle} ${getSearchEntityNoun(entityIdObject.type)}`;
            }

            // Posts start with "in ${channelName}: " and expect client rendering code to
            // add the post author name to the start of the title.
            if (entity.getAccountMediaShortName !== null && mention.entityId.startsWith("Post:")) {
                entityTitle = `${entity.getAccountMediaShortName()} ${entityTitle}`;
            }

            return entityTitle;
        }
        default:
            throw exhaustive(mention);
    }
}
