import {Node} from "prosemirror-model";
import {Step} from "prosemirror-transform";
import {ContentMention} from "~/shared/content/content_mention.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {ContentMentionAccountId} from "~/shared/id/types/id_types.js";
import {
    ProsemirrorVisitor,
    visitProsemirrorNode,
    visitProsemirrorStep,
} from "~/shared/prosemirror/prosemirror_visitor.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";

/**
 * Just the IDs we need for loading a `ContentReferences` object. Useful to
 * perform optimizations against. If there are no `ContentReferencedIds` then
 * you don't need to make a network request.
 */
export type ContentReferencedIds = SchemaType<typeof ContentReferencedIdsSchema>;

export const ContentReferencedIdsSchema = Schema.object({
    accountIds: Schema.set(Schema.id<ContentMentionAccountId>()),
});

/**
 * Is the provided `ContentReferencedIds` object empty?
 */
export function isEmptyContentReferencedIds(referencedIds: ContentReferencedIds): boolean {
    // If you add more data to `ContentReferencedIds` in the future, you'll
    // need to come back and update this function.
    assertEqualTypes<keyof ContentReferencedIds, "accountIds">();

    return referencedIds.accountIds.size === 0;
}

export function getContentReferencedIdsForNode(node: Node): ContentReferencedIds {
    return collectContentReferencedIds(visitor => {
        visitProsemirrorNode(node, visitor);
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
 */
export function collectContentReferencedIds(
    visit: (visitor: ProsemirrorVisitor) => void,
    extraVisitor: ProsemirrorVisitor = {},
): ContentReferencedIds {
    const accountIds = new Set<ContentMentionAccountId>();

    visit({
        visitNode: node => {
            if (node.type.name === "mention") {
                const mention: ContentMention = node.attrs.mention;
                accountIds.add(mention.accountId);
            }

            // Intentionally don't return boolean which cancels child visiting.
            extraVisitor.visitNode?.(node);
        },
        visitMark: mark => {
            extraVisitor.visitMark?.(mark);
        },
    });

    return {accountIds};
}
