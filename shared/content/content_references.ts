import {Node} from "prosemirror-model";
import {AccountId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
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
    accountById: Schema.map(Schema.id<AccountId>(), AccountModel.schema()),
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
