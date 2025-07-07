import {Mark} from "prosemirror-model";
import {getAccountRegistry} from "~/client/accounts/account_registry_context.js";
import {getSearchEntityRegistry} from "~/client/search/core/search_entity_registry_context.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";
import {
    printContentSingleLineTextSnippet,
    printContentSingleLineTextSnippetPreservingMarks,
} from "~/shared/content/print_content_single_line_text_snippet.js";
import {SpaceId} from "~/shared/id/types/id_types.js";
import {Store} from "~/shared/store/store.js";

/**
 * Calls `printContentSingleLineTextSnippet()` to print some content using the
 * content's `ContentReferences`.
 */
export function printContentSingleLineTextSnippetForClient(
    get: <Value>(store: Store<Value>) => Value,
    spaceId: SpaceId,
    content: ContentWithReferences,
): string {
    return printContentSingleLineTextSnippet(content.doc, {
        getAccountIfExists: accountId => {
            const account = content.references.accountById.get(accountId);
            if (!account) return null;
            return get(getAccountRegistry(spaceId).getAccountStore(account));
        },
        getSearchEntityIfExists: entityId => {
            const entity = content.references.searchEntityById.get(entityId);
            if (!entity) return null;
            if (entity.isPrivate) return entity;
            const {title} = get(getSearchEntityRegistry(spaceId).getEntityStore(entity.entity));
            return {isPrivate: false, title};
        },
    });
}

export function printContentSingleLineTextSnippetPreservingMarksForClient(
    get: <Value>(store: Store<Value>) => Value,
    spaceId: SpaceId,
    content: ContentWithReferences,
    shouldPreserveMark: (mark: Mark) => boolean,
): Array<{marks: ReadonlyArray<Mark>; text: string}> {
    return printContentSingleLineTextSnippetPreservingMarks(content.doc, {
        shouldPreserveMark,
        getAccountIfExists: accountId => {
            const account = content.references.accountById.get(accountId);
            if (!account) return null;
            return get(getAccountRegistry(spaceId).getAccountStore(account));
        },
        getSearchEntityIfExists: entityId => {
            const entity = content.references.searchEntityById.get(entityId);
            if (!entity) return null;
            if (entity.isPrivate) return entity;
            const {title} = get(getSearchEntityRegistry(spaceId).getEntityStore(entity.entity));
            return {isPrivate: false, title};
        },
    });
}
