import {AccountModelWithoutSpaceData} from "~/shared/accounts/account_model_without_space.js";
import {
    ContentReferencesSearchEntity,
    ContentWithReferences,
} from "~/shared/content/content_references.js";
import {printContentSingleLineTextSnippet} from "~/shared/content/print_content_single_line_text_snippet.js";
import {RenderContentMentionToTextSearchEntity} from "~/shared/content/render_content_mention_to_text.js";
import {FileContentType} from "~/shared/files/file_content_type.js";
import {FileModel} from "~/shared/files/file_model.js";
import {AccountId, FileId} from "~/shared/id/types/id_types.js";
import {getAuthorFromSearchEntityIfExists} from "~/shared/search/get_author_from_search_entity_if_exists.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

/**
 * Calls `printContentSingleLineTextSnippet()` to print some content using the
 * content's `ContentReferences`. However, instead of using the normalized data in
 * `AccountRegistry` and `SearchEntityRegistry` (which are only available on the
 * client) we use the immediately available data in `initialData`.
 *
 * On the client you should use `printContentSingleLineTextSnippetWithForClient()`
 * which uses the normalized `AccountRegistry` and `SearchEntityRegistry`.
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

export function getContentReferencesForServerPrintSingleLineTextSnippet(references: {
    readonly accountById: ReadonlyMap<
        AccountId,
        AccountModel | Omit<AccountModelWithoutSpaceData, "avatar">
    >;
    readonly searchEntityById: ReadonlyMap<
        SearchMentionEntityId,
        | ContentReferencesSearchEntity
        | (RenderContentMentionToTextSearchEntity & {entity?: undefined})
    >;
    readonly fileById?: ReadonlyMap<
        FileId,
        {readonly file: FileModel; readonly signedUrlSearch: string} | FileModel
    >;
}): {
    getAccountIfExists: (
        accountId: AccountId,
    ) => Omit<AccountModelWithoutSpaceData, "avatar"> | null;
    getSearchEntityIfExists: (
        entityId: SearchMentionEntityId,
    ) => RenderContentMentionToTextSearchEntity | null;
    getFileIfExists: (fileId: FileId) => {readonly contentType: FileContentType} | null;
} {
    return {
        getAccountIfExists: accountId => {
            const account = references.accountById.get(accountId);
            if (!account) return null;
            if ("initialData" in account) return account.initialData;
            return account;
        },
        getSearchEntityIfExists: entityId => {
            const entity = references.searchEntityById.get(entityId);
            if (!entity) return null;
            if (entity.isPrivate) return entity;

            if (!entity.entity) {
                return {
                    isPrivate: false,
                    title: entity.title,
                    getAuthorData: entity.getAuthorData,
                };
            }

            const entityData = entity.entity.initialData;
            const author = getAuthorFromSearchEntityIfExists(entityData);

            return {
                isPrivate: false,
                title: entityData.title,
                getAuthorData: author ? () => author.initialData : null,
            };
        },
        getFileIfExists: fileId => {
            let file = references.fileById?.get(fileId);
            if (!file) return null;
            if (!(file instanceof FileModel)) file = file.file;
            return file.initialData;
        },
    };
}
