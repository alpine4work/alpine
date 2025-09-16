import {createAccountNotFoundError} from "~/shared/accounts/account_error_messages.js";
import {createChatNotFoundError} from "~/shared/chat/chat_error_messages.js";
import {createDocumentNotFoundError} from "~/shared/documents/document_error_messages.js";
import {
    createChannelNotFoundError,
    createPostNotFoundError,
} from "~/shared/forum/forum_error_messages.js";
import {isId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ChatId,
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
