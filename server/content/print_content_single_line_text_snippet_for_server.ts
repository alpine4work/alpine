import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";
import {printContentSingleLineTextSnippet} from "~/shared/content/print_content_single_line_text_snippet.js";

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
    return printContentSingleLineTextSnippet(content.doc, {
        getAccountIfExists: accountId =>
            content.references.accountById.get(accountId)?.initialData ?? null,
        getSearchEntityIfExists: entityId => {
            const entity = content.references.searchEntityById.get(entityId);
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
    });
}
