import {AccountModelWithoutSpaceData} from "~/shared/accounts/account_model_without_space.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {missingAccountName} from "~/shared/accounts/missing_account_name.js";
import {ContentMention} from "~/shared/content/content_mention.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {iterateGraphemes} from "~/shared/helpers/string/iterate_graphemes.js";
import {ContentMentionAccountId} from "~/shared/id/types/id_types.js";
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

export function renderContentMentionToText(
    mention: ContentMention,
    {
        getAccountIfExists,
        getSearchEntityIfExists,
    }: {
        getAccountIfExists: (
            accountId: ContentMentionAccountId,
        ) => AccountModelWithoutSpaceData | null;
        getSearchEntityIfExists: (
            entityId: SearchMentionEntityId,
        ) => {isPrivate: false; title: string | null} | {isPrivate: true} | null;
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

            const entityTitle = truncateContentMentionText(entity.title);

            if (entityTitle.length === 0) {
                const entityIdObject = parseSearchMentionEntityId(mention.entityId);
                return `${missingSearchEntityTitle} ${getSearchEntityNoun(entityIdObject.type)}`;
            }

            return entityTitle;
        }
        default:
            throw exhaustive(mention);
    }
}

export function truncateContentMentionText(string: string) {
    string = string.trim();

    let length = 0;
    let graphemeCount = 0;
    let isTruncated = false;

    const softMaxGraphemeCount = 130;

    // According to Claude, 99% of English words are 14 characters or shorter. So
    // we should safely be able to include an English word before we truncate.
    const hardMaxGraphemeCount = softMaxGraphemeCount + 14;

    for (const grapheme of iterateGraphemes(string)) {
        // Truncate after the hard break max grapheme count.
        if (graphemeCount >= hardMaxGraphemeCount) {
            isTruncated = true;
            break;
        }

        // Break at the first whitespace we see after the soft max grapheme count.
        if (graphemeCount >= softMaxGraphemeCount && /^\p{White_Space}+$/u.test(grapheme)) {
            isTruncated = true;
            break;
        }

        length += grapheme.length;
        graphemeCount++;
    }

    return string.slice(0, length) + (isTruncated ? " […]" : "");
}
