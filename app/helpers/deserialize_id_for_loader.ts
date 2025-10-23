import {createAccountNotFoundError} from "~/shared/accounts/account_error_messages.js";
import {createChatNotFoundError} from "~/shared/chat/chat_error_messages.js";
import {
    createDocumentCommentThreadNotFoundError,
    createDocumentNotFoundError,
} from "~/shared/documents/document_error_messages.js";
import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {
    createChannelNotFoundError,
    createPostNotFoundError,
} from "~/shared/forum/forum_error_messages.js";
import {isId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SpaceId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {createSpaceNotFoundError} from "~/shared/spaces/space_error_messages.js";
import {createTaskNotFoundError} from "~/shared/tasks/task_error_messages.js";

export function deserializeAccountIdForLoader(id: string | null | undefined): AccountId {
    if (!id || !isId(id)) {
        throw createAccountNotFoundError(id || undefined);
    }

    return Schema.id<AccountId>().deserialize(id);
}

export function deserializeDocumentIdForLoader(id: string | null | undefined): DocumentId {
    if (!id || !isId(id)) {
        throw createDocumentNotFoundError(id || undefined);
    }

    return Schema.id<DocumentId>().deserialize(id);
}

export function deserializeDocumentCommentThreadIdForLoader(
    documentId: DocumentId,
    id: string | null | undefined,
): DocumentCommentThreadId {
    if (!id || !isId(id)) {
        throw createDocumentCommentThreadNotFoundError(documentId, id || undefined);
    }

    return Schema.id<DocumentCommentThreadId>().deserialize(id);
}

export function deserializeChannelIdForLoader(id: string | null | undefined): ChannelId {
    if (!id || !isId(id)) {
        throw createChannelNotFoundError(id || undefined);
    }

    return Schema.id<ChannelId>().deserialize(id);
}

export function deserializeChatIdForLoader(id: string | null | undefined): ChatId {
    if (!id || !isId(id)) {
        throw createChatNotFoundError(id || undefined);
    }

    return Schema.id<ChatId>().deserialize(id);
}

export function deserializeTaskIdForLoader(id: string | null | undefined): TaskId {
    if (!id || !isId(id)) {
        throw createTaskNotFoundError(id || undefined);
    }

    return Schema.id<TaskId>().deserialize(id);
}

export function deserializePostIdForLoader(id: string | null | undefined): PostId {
    if (!id || !isId(id)) {
        throw createPostNotFoundError(id || undefined);
    }

    return Schema.id<PostId>().deserialize(id);
}

export function deserializeSpaceIdForLoader(id: string | null | undefined): SpaceId {
    if (!id || !isId(id)) {
        throw createSpaceNotFoundError(id || undefined);
    }

    return Schema.id<SpaceId>().deserialize(id);
}

export function deserializeMessageIndexForLoader(
    messageNoun: "message" | "comment",
    indexString: string | null | undefined,
): number {
    indexString ??= "";

    const indexNumber = parseInt(indexString, 10);

    if (
        !/^(0|[1-9][0-9]*)$/.test(indexString) ||
        isNaN(indexNumber) ||
        indexNumber < 0 ||
        !Number.isSafeInteger(indexNumber)
    ) {
        throw new NotFoundError(`Invalid ${messageNoun} index`, {
            displayMessage: {
                message: errorDisplayMessage`This message doesn’t exist. Try searching “my messages” to see messages you’ve created.`,
                comment: errorDisplayMessage`This comment doesn’t exist. Try searching “my comments” to see comments you’ve created.`,
            }[messageNoun],
        });
    }

    return indexNumber;
}
