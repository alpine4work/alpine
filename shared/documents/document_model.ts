import {AccountModel} from "~/shared/accounts/account_model";
import {ContentReferencesSchema, emptyContentReferences} from "~/shared/content/content_references";
import {DocumentContent, DocumentContentSchema} from "~/shared/documents/document_content_schema";
import {documentFallbackTitle} from "~/shared/documents/document_fallback_title";
import {assert} from "~/shared/helpers/control/assert";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types";
import {concatIterables} from "~/shared/helpers/iterable/concat_iterables";
import {isId} from "~/shared/id/id";
import {DocumentCommentThreadId, DocumentId, SpaceId} from "~/shared/id/types/id_types";
import {MessageModel, MessagePayloadModelSchema} from "~/shared/messaging/message_model";
import {Model} from "~/shared/schema/model/model";
import {Schema, SchemaType} from "~/shared/schema/schema";

/**
 * A thread of comments on a document.
 */
export class DocumentCommentThreadModel extends Model(
    Schema.object({
        id: Schema.id<DocumentCommentThreadId>(),
        /**
         * The document this comment thread is for.
         */
        documentId: Schema.id<DocumentId>(),
        /**
         * The time at which this comment thread was created.
         */
        createdTime: Schema.date,
        /**
         * The total number of comments in the thread.
         */
        commentCount: Schema.integer,
        /**
         * The last time a comment in this thread changed.
         */
        lastCommentChangeTime: Schema.date.nullable(),
        /**
         * All of the authors who commented on this thread.
         *
         * We include all authors instead of a limited preview so the list can update
         * in realtime without needing to load the thread.
         */
        commentAuthors: Schema.array(AccountModel.schema()),
    }),
) {}

/**
 * A comment on a document.
 */
export class DocumentCommentModel
    extends Model(
        Schema.object({
            documentId: Schema.id<DocumentId>(),
            commentThreadId: Schema.id<DocumentCommentThreadId>(),
            index: Schema.integer,
            author: AccountModel.schema(),
            createdTime: Schema.date,
            payload: MessagePayloadModelSchema,
        }),
    )
    implements MessageModel<DocumentCommentRoomKey>
{
    // Make sure this property is available on this type and not just the
    // interface.
    public readonly isOptimistic?: undefined;

    public getRoomKey() {
        return encodeDocumentCommentRoomKey(this.documentId, this.commentThreadId);
    }
}

export type DocumentContentReferences = SchemaType<typeof DocumentContentReferencesSchema>;

/**
 * Documents may have content which needs data beyond what the base content
 * type needs.
 */
export const DocumentContentReferencesSchema = ContentReferencesSchema.merge(
    Schema.object({
        /**
         * The comment threads in our document. Deleting the text associated with a
         * document comment does not delete the underlying thread but the thread will
         * no longer be a part of this map.
         */
        commentThreadById: Schema.map(
            Schema.id<DocumentCommentThreadId>(),
            // A subset of the full `DocumentCommentThreadModel`.
            Schema.object({
                commentCount: Schema.integer,
                commentAuthors: Schema.array(AccountModel.schema()),
            }),
        ),
    }),
);

export const emptyDocumentContentReferences: DocumentContentReferences = {
    ...emptyContentReferences,
    commentThreadById: new Map(),
};

export function isEmptyDocumentContentReferences(references: DocumentContentReferences): boolean {
    // If you add more data to `DocumentContentReferences` in the future, you'll
    // need to come back and update this function.
    assertEqualTypes<keyof DocumentContentReferences, "accountById" | "commentThreadById">();

    return references.accountById.size === 0 && references.commentThreadById.size === 0;
}

export function mergeDocumentContentReferences(
    references1: DocumentContentReferences,
    references2: DocumentContentReferences,
): DocumentContentReferences {
    // Optimization: Don't create a new references object for every step we receive
    // from the server with empty references.
    if (isEmptyDocumentContentReferences(references1)) return references2;
    if (isEmptyDocumentContentReferences(references2)) return references1;

    const commentThreadById = new Map<
        DocumentCommentThreadId,
        {
            commentCount: number;
            commentAuthors: ReadonlyArray<AccountModel>;
        }
    >();

    // Merge comment threads together by taking the one with the higher comment
    // count. Comments may never be deleted so the comment thread with more
    // comments is guaranteed to be newer.
    for (const [commentThreadId, commentThread] of concatIterables(
        references1.commentThreadById,
        references2.commentThreadById,
    )) {
        const existingCommentThread = commentThreadById.get(commentThreadId);
        if (
            !existingCommentThread ||
            existingCommentThread.commentCount < commentThread.commentCount
        ) {
            commentThreadById.set(commentThreadId, commentThread);
        }
    }

    return {
        accountById: new Map(concatIterables(references1.accountById, references2.accountById)),
        commentThreadById,
    };
}

export type DocumentContentWithReferences = SchemaType<typeof DocumentContentWithReferencesSchema>;

export const DocumentContentWithReferencesSchema = Schema.object({
    doc: DocumentContentSchema,
    references: DocumentContentReferencesSchema,
});

/**
 * A rich text, collaboratively editable, document.
 *
 * Code naming note: Whenever we refer to full documents product in code we
 * write it as "documents". Whenever we refer to an individual document we
 * write it as "document". This is why we call our model `DocumentModel` but we
 * call our table `DocumentsTable` and our RPC definitions
 * `documents_rpc_definition.ts`. `DocumentsTable` and
 * `documents_rpc_definition.ts` are referring to the entire documents
 * product.
 */
export class DocumentModel
    extends Model(
        Schema.object({
            id: Schema.id<DocumentId>(),
            spaceId: Schema.id<SpaceId>(),
            createdTime: Schema.date,
            version: Schema.integer,
            content: DocumentContentWithReferencesSchema,
        }),
    )
    implements DocumentPreviewInterface
{
    public getTitle() {
        return getDocumentContentTitle(this.content.doc);
    }

    public getTitleWithoutFallback() {
        return getDocumentContentTitleWithoutFallback(this.content.doc);
    }
}

/**
 * Get the title of a document as it is. If the document has no title then a
 * empty string will be returned.
 */
export function getDocumentContentTitleWithoutFallback(content: DocumentContent): string {
    const childNode = content.child(0);
    assert(childNode.type.name === "title");
    return childNode.textContent.trim();
}

/**
 * Get the title of a document.
 *
 * If there is no title then the document is given a fallback name
 * like "Untitled".
 */
export function getDocumentContentTitle(content: DocumentContent): string {
    const title = getDocumentContentTitleWithoutFallback(content);
    return addFallbackToDocumentTitle(title);
}

/**
 * Return the title string and if the title is empty then return a fallback
 * name like "Untitled".
 */
export function addFallbackToDocumentTitle(title: string): string {
    return title.trim().length > 0 ? title : documentFallbackTitle;
}

/**
 * The preview of a rich text document.
 *
 * We have a shared interface that both `DocumentModel` and
 * `DocumentPreviewModel` implement that code which needs a preview can use to
 * accept either underlying model.
 */
export interface DocumentPreviewInterface {
    readonly id: DocumentId;
    getTitle(): string;
    getTitleWithoutFallback(): string;
}

/**
 * The preview of a rich text document.
 *
 * Documents can get pretty big so the preview is a smaller subset of the
 * document we can load quickly.
 */
export class DocumentPreviewModel
    extends Model(
        Schema.object({
            id: Schema.id<DocumentId>(),
            createdTime: Schema.date,
            spaceId: Schema.id<SpaceId>(),
            version: Schema.integer,
            titleWithoutFallback: Schema.string,
        }),
    )
    implements DocumentPreviewInterface
{
    public getTitle() {
        return addFallbackToDocumentTitle(this.titleWithoutFallback);
    }

    public getTitleWithoutFallback() {
        return this.titleWithoutFallback;
    }
}

/**
 * An opaque room key for a document comment.
 */
export type DocumentCommentRoomKey = string & {readonly _DocumentCommentRoomKey: never};

export function encodeDocumentCommentRoomKey(
    documentId: DocumentId,
    commentThreadId: DocumentCommentThreadId,
): DocumentCommentRoomKey {
    return `${documentId}-${commentThreadId}` as DocumentCommentRoomKey;
}

export function decodeDocumentCommentRoomKey(
    roomKey: DocumentCommentRoomKey,
): [DocumentId, DocumentCommentThreadId] {
    const [documentId = "", commentThreadId = ""] = roomKey.split("-", 2);
    assert(isId<DocumentId>(documentId));
    assert(isId<DocumentCommentThreadId>(commentThreadId));
    return [documentId, commentThreadId];
}

export const maxDocumentCommentThreadPreviewCommentAuthorCount = 3;
