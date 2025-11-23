import {Mark} from "prosemirror-model";
import {AccountRegistry} from "~/client/web/accounts/account_registry.js";
import {FileRegistry} from "~/client/web/content/file_registry.js";
import {SearchEntityRegistry} from "~/client/web/search/core/search_entity_registry.js";
import {AccountModelWithoutSpaceData} from "~/shared/accounts/account_model_without_space.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {ContentReferences, ContentWithReferences} from "~/shared/content/content_references.js";
import {
    printContentSingleLineTextSnippet,
    printContentSingleLineTextSnippetPreservingMarks,
} from "~/shared/content/print_content_single_line_text_snippet.js";
import {RenderContentMentionToTextSearchEntity} from "~/shared/content/render_content_mention_to_text.js";
import {FileModelData} from "~/shared/files/file_model.js";
import {AccountId, FileId} from "~/shared/id/types/id_types.js";
import {SearchMentionEntityId} from "~/shared/search/search_entity_id.js";
import {Store} from "~/shared/store/store.js";

/**
 * Calls `printContentSingleLineTextSnippet()` to print some content using the
 * content's `ContentReferences`.
 */
export function printContentSingleLineTextSnippetForClient(
    get: <Value>(store: Store<Value>) => Value,
    content: ContentWithReferences,
    options: {
        accountRegistry: AccountRegistry;
        searchEntityRegistry: SearchEntityRegistry;
        fileRegistry: FileRegistry;
    },
): string {
    return printContentSingleLineTextSnippet(
        content.doc,
        getContentReferencesForClientPrintSingleLineTextSnippet(get, content.references, options),
    );
}

export function printContentSingleLineTextSnippetPreservingMarksForClient(
    get: <Value>(store: Store<Value>) => Value,
    content: ContentWithReferences,
    options: {
        shouldPreserveMark: (mark: Mark) => boolean;
        accountRegistry: AccountRegistry;
        searchEntityRegistry: SearchEntityRegistry;
        fileRegistry: FileRegistry;
    },
): Array<{marks: ReadonlyArray<Mark>; text: string}> {
    return printContentSingleLineTextSnippetPreservingMarks(content.doc, {
        ...getContentReferencesForClientPrintSingleLineTextSnippet(
            get,
            content.references,
            options,
        ),
        shouldPreserveMark: options.shouldPreserveMark,
    });
}

export function getContentReferencesForClientPrintSingleLineTextSnippet(
    get: <Value>(store: Store<Value>) => Value,
    references: ContentReferences,
    {
        accountRegistry,
        searchEntityRegistry,
        fileRegistry,
    }: {
        accountRegistry: AccountRegistry;
        searchEntityRegistry: SearchEntityRegistry;
        fileRegistry: FileRegistry;
    },
): {
    getAccountIfExists: (accountId: AccountId) => AccountModelWithoutSpaceData | null;
    getSearchEntityIfExists: (
        entityId: SearchMentionEntityId,
    ) => RenderContentMentionToTextSearchEntity | null;
    getFileIfExists: (fileId: FileId) => FileModelData | null;
} {
    return {
        getAccountIfExists: accountId => {
            const account = references.accountById.get(accountId);
            if (!account) return null;
            return get(accountRegistry.getAccountStore(account));
        },
        getSearchEntityIfExists: entityId => {
            const entity = references.searchEntityById.get(entityId);
            if (!entity) return null;
            if (entity.isPrivate) return entity;

            const entityData = get(searchEntityRegistry.getEntityStore(entity.entity));
            const entityDataMedia = entityData.media;

            return {
                isPrivate: false,
                title: entityData.title,
                getAccountMediaShortName:
                    entityDataMedia?.type === "Account"
                        ? () => {
                              const accountData = get(
                                  accountRegistry.getAccountStore(entityDataMedia.account),
                              );

                              return getAccountShortNameWithoutFullNameTooltip(accountData);
                          }
                        : null,
            };
        },
        getFileIfExists: fileId => {
            const file = references.fileById?.get(fileId);
            if (!file) return null;
            return get(fileRegistry.getFileStore(file));
        },
    };
}
