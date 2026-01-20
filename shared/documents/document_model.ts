import {AccessPolicySchema} from "~/shared/access/access_policy.js";
import {
    DocumentContentWithReferencesSchema,
    DocumentWithOptionalTitleContentWithReferencesSchema,
} from "~/shared/documents/document_content_references.js";
import {DocumentContent} from "~/shared/documents/document_content_schema.js";
import {documentFallbackTitle} from "~/shared/documents/document_fallback_title.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isId} from "~/shared/id/id.js";
import {DocumentCommentThreadId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
import {MessageModel, MessagePayloadModelSchema} from "~/shared/messaging/message_model.js";
import {MessageStreamSchema} from "~/shared/messaging/message_schema.js";
import {TimeZoneSchema} from "~/shared/schema/helpers/time_zone_schema.js";
import {Model} from "~/shared/schema/model/model.js";
import {Schema} from "~/shared/schema/schema.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

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
         * The version of this comment thread model object. Useful for resolving
         * conflicting updates. From `updateLockVersion` in DynamoDB.
         */
        version: Schema.integer,

        /**
         * When the comment is no longer referenced in the document you can render this
         * content snippet in the comment thread's preview component.
         */
        fallbackContentSnippet: DocumentWithOptionalTitleContentWithReferencesSchema.nullable(),

        /**
         * Is the document comment thread resolved?
         */
        isResolved: Schema.boolean,

        /**
         * The total number of comments in the thread.
         */
        commentCount: Schema.integer,

        /**
         * The author of the first comment on the thread. The thread creator. There's
         * a whole list of comment authors in document content references.
         */
        firstCommentAuthor: AccountModel.schema.nullable(),
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
            version: Schema.integer,
            author: AccountModel.schema,
            createdTime: Schema.date,
            createdTimeZone: TimeZoneSchema,
            payload: MessagePayloadModelSchema,
            stream: MessageStreamSchema.nullable(),
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

    public getSeeReactionsUrl(
        spaceId: SpaceId,
        contentVersion: number,
        pos: number | "Files",
    ): string {
        const baseUrl = `/s/${spaceId}/documents/${this.documentId}/comments/${this.commentThreadId}/${this.index}/reactions`;
        const at = pos === "Files" ? "files" : `${pos}@${contentVersion}`;
        return `${baseUrl}?at=${at}`;
    }
}

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
            accessPolicy: AccessPolicySchema,
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

export function decodePossiblyDocumentCommentRoomKey(roomKey: string): [string, string] {
    const [documentId = "", commentThreadId = ""] = roomKey.split("-", 2);
    return [documentId, commentThreadId];
}

export const maxDocumentCommentThreadPreviewCommentAuthorCount = 3;
