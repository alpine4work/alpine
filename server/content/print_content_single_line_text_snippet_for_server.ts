import {AccountModelWithoutSpaceData} from "~/shared/accounts/account_model_without_space.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ContentReferences, ContentWithReferences} from "~/shared/content/content_references.js";
import {printContentSingleLineTextSnippet} from "~/shared/content/print_content_single_line_text_snippet.js";
import {RenderContentMentionToTextSearchEntity} from "~/shared/content/render_content_mention_to_text.js";
import {ContentMentionAccountId} from "~/shared/id/types/id_types.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";

/**
 * Calls `printContentSingleLineTextSnippet()` to print some content using the
 * content's `ContentReferences`. However, instead of using the normalized data
 * in `AccountRegistry` and `SearchEntityRegistry` (which are only available on
 * the client) we use the immediately available data in `initialData`.
 *
 * On the client you should use
 * `printContentSingleLineTextSnippetWithForClient()` which uses the normalized
 * `AccountRegistry` and `SearchEntityRegistry`.
 *
 * This is in `//server/content` so you can't import this function at all on the
 * client.
 */
export function printContentSingleLineTextSnippetForServer(content: ContentWithReferences) {
    return printContentSingleLineTextSnippet(
        content.doc,
        getContentReferencesForServerPrintSingleLineTextSnippet(content.references),
    );
}

export function getContentReferencesForServerPrintSingleLineTextSnippet(
    references: ContentReferences,
): {
    getAccountIfExists: (accountId: ContentMentionAccountId) => AccountModelWithoutSpaceData | null;
    getSearchEntityIfExists: (
        entityId: SearchMentionEntityId,
    ) => RenderContentMentionToTextSearchEntity | null;
} {
    return {
        getAccountIfExists: accountId => references.accountById.get(accountId)?.initialData ?? null,
        getSearchEntityIfExists: entityId => {
            const entity = references.searchEntityById.get(entityId);
            if (!entity) return null;
            if (entity.isPrivate) return entity;

            const entityData = entity.entity.initialData;
            const entityDataMedia = entityData.media;

            return {
                isPrivate: false,
                title: entityData.title,
                getAccountMediaShortName:
                    entityDataMedia?.type === "Account"
                        ? () =>
                              getAccountShortNameWithoutFullNameTooltip(
                                  entityDataMedia.account.initialData,
                              )
                        : null,
            };
        },
    };
}
