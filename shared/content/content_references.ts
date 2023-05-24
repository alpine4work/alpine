import {Node} from "prosemirror-model";
import {AccountModel} from "~/shared/accounts/account_model";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables";
import {ContentMentionAccountId} from "~/shared/id/types/id_types";
import {Schema, SchemaType} from "~/shared/schema/schema";

export type ContentReferences = SchemaType<typeof ContentReferencesSchema>;

/**
 * Data referenced by content that doesn't live inside the content.
 *
 * For example, mentions store an `AccountId` in the content but don't store
 * the associated account name and avatar. Since a user could update their
 * account name and we don't want to then go update all content. So instead, we
 * load account data in this references object.
 */
export const ContentReferencesSchema = Schema.object({
    /**
     * Accounts referenced in mentions.
     */
    accountById: Schema.map(Schema.id<ContentMentionAccountId>(), AccountModel.schema()),
});

/**
 * A content node alongside its references. We pass around this type instead of
 * content alone to force the collocation of references with content. You can't
 * interpret a content node without its references.
 */
export type ContentWithReferences = {
    readonly doc: Node;
    readonly references: ContentReferences;
};

export const emptyContentReferences: ContentReferences = {
    accountById: new Map(),
};

/**
 * Is the provided `ContentReferences` object empty?
 */
export function isEmptyContentReferences(references: ContentReferences): boolean {
    // If you add more data to `ContentReferences` in the future, you'll
    // need to come back and update this function.
    assertEqualTypes<keyof ContentReferences, "accountById">();

    return references.accountById.size === 0;
}

/**
 * Merge two `ContentReferences` into one. References in the second object will
 * override references in the first.
 */
export function mergeContentReferences(
    references1: ContentReferences,
    references2: ContentReferences,
): ContentReferences {
    // Optimization: Don't create a new references object for every step we receive
    // from the server with empty references.
    if (isEmptyContentReferences(references1)) return references2;
    if (isEmptyContentReferences(references2)) return references1;

    return {
        accountById: new Map(concatIterables(references1.accountById, references2.accountById)),
    };
}
