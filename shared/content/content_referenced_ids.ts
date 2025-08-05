import {Fragment, Node, Slice} from "prosemirror-model";
import {Step} from "prosemirror-transform";
import {ContentMention} from "~/shared/content/content_mention.js";
import {FileEntityId, FileEntityIdSchema, isFileEntityId} from "~/shared/files/file_entity_id.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {emptySet} from "~/shared/helpers/set/empty_set.js";
import {isId} from "~/shared/id/id.js";
import {AccountId, FileId} from "~/shared/id/types/id_types.js";
import {
    ProsemirrorVisitor,
    visitProsemirrorFragment,
    visitProsemirrorNode,
    visitProsemirrorSlice,
    visitProsemirrorStep,
} from "~/shared/prosemirror/prosemirror_visitor.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {
    SearchMentionEntityId,
    SearchMentionEntityIdSchema,
} from "~/shared/search/search_entity_id.js";

/**
 * Just the IDs we need for loading a `ContentReferences` object. Useful to
 * perform optimizations against. If there are no `ContentReferencedIds` then
 * you don't need to make a network request.
 */
export type ContentReferencedIds = SchemaType<typeof ContentReferencedIdsSchema>;

export const ContentReferencedIdsSchema = Schema.object({
    accountIds: Schema.set(Schema.id<AccountId>()),
    searchEntityIds: Schema.set(SearchMentionEntityIdSchema),
    fileIds: Schema.set(Schema.id<FileId>()),
    fileEntityIds: Schema.set(FileEntityIdSchema),
});

export const emptyContentReferencedIds: ContentReferencedIds = {
    accountIds: emptySet,
    searchEntityIds: emptySet,
    fileIds: emptySet,
    fileEntityIds: emptySet,
};

/**
 * Is the provided `ContentReferencedIds` object empty?
 */
export function isEmptyContentReferencedIds(referencedIds: ContentReferencedIds): boolean {
    // If you add more data to `ContentReferencedIds` in the future, you'll
    // need to come back and update this function.
    assertEqualTypes<
        keyof ContentReferencedIds,
        "accountIds" | "searchEntityIds" | "fileIds" | "fileEntityIds"
    >();

    return (
        referencedIds.accountIds.size === 0 &&
        referencedIds.searchEntityIds.size === 0 &&
        referencedIds.fileIds.size === 0 &&
        referencedIds.fileEntityIds.size === 0
    );
}

export function getContentReferencedIdsForNode(node: Node): ContentReferencedIds {
    return collectContentReferencedIds(visitor => {
        visitProsemirrorNode(node, visitor);
    });
}

export function getContentReferencedIdsForFragment(fragment: Fragment): ContentReferencedIds {
    return collectContentReferencedIds(visitor => {
        visitProsemirrorFragment(fragment, visitor);
    });
}

export function getContentReferencedIdsForSlice(slice: Slice): ContentReferencedIds {
    return collectContentReferencedIds(visitor => {
        visitProsemirrorSlice(slice, visitor);
    });
}

export function getContentReferencedIdsForSteps(steps: ReadonlyArray<Step>): ContentReferencedIds {
    return collectContentReferencedIds(visitor => {
        for (const step of steps) {
            visitProsemirrorStep(step, visitor);
        }
    });
}

/**
 * Low-level function for collecting IDs referenced in some ProseMirror
 * object. Generally prefer using `getContentReferencedIdsForNode()` or
 * `getContentReferencedIdsForStep()`.
 *
 * You use the function like this:
 *
 * ```ts
 * collectContentReferencedIds(visitor => {
 *     visitProsemirrorNode(content, visitor);
 * })
 * ```
 *
 * Returns referenced IDs in the order we encounter them. So if there are three
 * files the IDs of the files appear in document order.
 */
export function collectContentReferencedIds(
    visit: (visitor: ProsemirrorVisitor) => void,
    extraVisitor: ProsemirrorVisitor = {},
): ContentReferencedIds {
    const accountIds = new Set<AccountId>();
    const searchEntityIds = new Set<SearchMentionEntityId>();
    const fileIds = new Set<FileId>();
    const fileEntityIds = new Set<FileEntityId>();

    visit({
        visitNode: node => {
            // Intentionally don't return boolean which cancels child visiting.
            extraVisitor.visitNode?.(node);
        },
        visitMark: mark => {
            extraVisitor.visitMark?.(mark);
        },
        visitAttr: (attr, value) => {
            if (attr === "mention") {
                const mention: ContentMention = value;
                switch (mention.type) {
                    case "Account":
                        accountIds.add(mention.accountId);
                        break;
                    case "SearchEntity":
                        searchEntityIds.add(mention.entityId);
                        break;
                    default:
                        throw exhaustive(mention);
                }
            }

            if (attr === "fileId") {
                const fileId: FileId | FileEntityId | null = value;
                if (fileId !== null) {
                    if (isId<FileId>(fileId)) {
                        fileIds.add(fileId);
                    } else {
                        assert(isFileEntityId(fileId));
                        fileEntityIds.add(fileId);
                    }
                }
            }

            extraVisitor.visitAttr?.(attr, value);
        },
    });

    return {accountIds, searchEntityIds, fileIds, fileEntityIds};
}
