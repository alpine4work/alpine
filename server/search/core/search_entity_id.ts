import {InternalError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    ContentMentionAccountId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";

/**
 * The internal identifier of an entity in our search system. Search entities
 * are a consistent format we convert all content in our system to and put in
 * OpenSearch that we can search across.
 */
export type SearchEntityId =
    | `Account:${AccountId | ContentMentionAccountId}`
    | `Document:${DocumentId}` // NOCOMMIT: Index
    | `DocumentComment:${DocumentId}-${DocumentCommentThreadId}-${number}` // NOCOMMIT: Index
    | `Channel:${ChannelId}` // NOCOMMIT: Index
    | `Post:${PostId}` // NOCOMMIT: Index
    | `PostComment:${PostId}-${number}` // NOCOMMIT: Index
    | `Chat:${ChatId}` // NOCOMMIT: Index
    | `ChatMessage:${ChatId}-${number}` // NOCOMMIT: Index
    | `Task:${TaskId}` // NOCOMMIT: Index
    | `TaskCollection:${TaskCollectionId}`; // NOCOMMIT: Index

/**
 * Parsed representation of a `SearchEntityId` string for easier manipulation.
 * Convert `SearchEntityId` to this object with `parseSearchEntityId()`.
 */
export type SearchEntityIdObject =
    | {readonly type: "Account"; readonly accountId: AccountId}
    | {readonly type: "Document"; readonly documentId: DocumentId}
    | {
          readonly type: "DocumentComment";
          readonly documentId: DocumentId;
          readonly commentThreadId: DocumentCommentThreadId;
          readonly commentIndex: number;
      }
    | {readonly type: "Channel"; readonly channelId: ChannelId}
    | {readonly type: "Post"; readonly postId: PostId}
    | {readonly type: "PostComment"; readonly postId: PostId; readonly commentIndex: number}
    | {readonly type: "Chat"; readonly chatId: ChatId}
    | {readonly type: "ChatMessage"; readonly chatId: ChatId; readonly messageIndex: number}
    | {readonly type: "Task"; readonly taskId: TaskId}
    | {readonly type: "TaskCollection"; readonly collectionId: TaskCollectionId};

/**
 * Parse a `SearchEntityId` into a more convenient to use object format.
 */
export function parseSearchEntityId(id: SearchEntityId): SearchEntityIdObject {
    const [idType, idPayload] = id.split(":");
    const idPayloadParts = idPayload?.split("-") ?? [];

    switch (idType) {
        case "Account":
            return {type: "Account", accountId: idPayloadParts[0] as AccountId};
        case "Document":
            return {type: "Document", documentId: idPayloadParts[0] as DocumentId};
        case "DocumentComment":
            return {
                type: "DocumentComment",
                documentId: idPayloadParts[0] as DocumentId,
                commentThreadId: idPayloadParts[1] as DocumentCommentThreadId,
                commentIndex: parseInt(idPayloadParts[2]!, 10),
            };
        case "Channel":
            return {type: "Channel", channelId: idPayloadParts[0] as ChannelId};
        case "Post":
            return {type: "Post", postId: idPayloadParts[0] as PostId};
        case "PostComment":
            return {
                type: "PostComment",
                postId: idPayloadParts[0] as PostId,
                commentIndex: parseInt(idPayloadParts[1]!, 10),
            };
        case "Chat":
            return {type: "Chat", chatId: idPayloadParts[0] as ChatId};
        case "ChatMessage":
            return {
                type: "ChatMessage",
                chatId: idPayloadParts[0] as ChatId,
                messageIndex: parseInt(idPayloadParts[1]!, 10),
            };
        case "Task":
            return {type: "Task", taskId: idPayloadParts[0] as TaskId};
        case "TaskCollection":
            return {type: "TaskCollection", collectionId: idPayloadParts[0] as TaskCollectionId};
        default:
            throw new InternalError(quote`Unrecognized search entity ID type ${idType ?? ""}`);
    }
}

/**
 * Print a `SearchEntityId` from the more convenient to manipulate object
 * format.
 */
export function printSearchEntityId(idObject: SearchEntityIdObject): SearchEntityId {
    switch (idObject.type) {
        case "Account":
            return `Account:${idObject.accountId}`;
        case "Document":
            return `Document:${idObject.documentId}`;
        case "DocumentComment":
            return `DocumentComment:${idObject.documentId}-${idObject.commentThreadId}-${idObject.commentIndex}`;
        case "Channel":
            return `Channel:${idObject.channelId}`;
        case "Post":
            return `Post:${idObject.postId}`;
        case "PostComment":
            return `PostComment:${idObject.postId}-${idObject.commentIndex}`;
        case "Chat":
            return `Chat:${idObject.chatId}`;
        case "ChatMessage":
            return `ChatMessage:${idObject.chatId}-${idObject.messageIndex}`;
        case "Task":
            return `Task:${idObject.taskId}`;
        case "TaskCollection":
            return `TaskCollection:${idObject.collectionId}`;
        default:
            throw exhaustive(idObject);
    }
}
