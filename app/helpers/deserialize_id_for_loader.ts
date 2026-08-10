import {createAccountNotFoundError} from "~/shared/accounts/account_error_messages.js";
import {createBotNotFoundError} from "~/shared/bots/bot_error_messages.js";
import {createChatNotFoundError} from "~/shared/chat/chat_error_messages.js";
import {createDatabaseTableNotFoundError} from "~/shared/databases/database_error_messages.js";
import {
    createDocumentCommentThreadNotFoundError,
    createDocumentNotFoundError,
} from "~/shared/documents/document_error_messages.js";
import {NotFoundError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {
    createChannelNotFoundError,
    createPostNotFoundError,
} from "~/shared/forum/forum_error_messages.js";
import {isId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    BotId,
    ChannelId,
    ChatId,
    DatabaseTableId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SiteId,
    SpaceId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";
import {createSiteNotFoundError} from "~/shared/sites/site_error_messages.js";
import {createSpaceNotFoundError} from "~/shared/spaces/space_error_messages.js";
import {createTaskNotFoundError} from "~/shared/tasks/task_error_messages.js";

export function deserializeAccountIdForLoader(id: string | null | undefined): AccountId {
    if (!id || !isId<AccountId>(id)) {
        throw createAccountNotFoundError(id ?? undefined);
    }

    return id;
}

export function deserializeDocumentIdForLoader(id: string | null | undefined): DocumentId {
    if (!id || !isId<DocumentId>(id)) {
        throw createDocumentNotFoundError(id ?? undefined);
    }

    return id;
}

export function deserializeDocumentCommentThreadIdForLoader(
    documentId: DocumentId,
    id: string | null | undefined,
): DocumentCommentThreadId {
    if (!id || !isId<DocumentCommentThreadId>(id)) {
        throw createDocumentCommentThreadNotFoundError(documentId, id ?? undefined);
    }

    return id;
}

export function deserializeChannelIdForLoader(id: string | null | undefined): ChannelId {
    if (!id || !isId<ChannelId>(id)) {
        throw createChannelNotFoundError(id ?? undefined);
    }

    return id;
}

export function deserializeChatIdForLoader(id: string | null | undefined): ChatId {
    if (!id || !isId<ChatId>(id)) {
        throw createChatNotFoundError(id ?? undefined);
    }

    return id;
}

export function deserializeDatabaseTableIdForLoader(
    id: string | null | undefined,
): DatabaseTableId {
    if (!id || !isId<DatabaseTableId>(id)) {
        throw createDatabaseTableNotFoundError(id ?? undefined);
    }

    return id;
}

export function deserializeTaskIdForLoader(id: string | null | undefined): TaskId {
    if (!id || !isId<TaskId>(id)) {
        throw createTaskNotFoundError(id ?? undefined);
    }

    return id;
}

export function deserializePostIdForLoader(id: string | null | undefined): PostId {
    if (!id || !isId<PostId>(id)) {
        throw createPostNotFoundError(id ?? undefined);
    }

    return id;
}

export function deserializeSpaceIdForLoader(id: string | null | undefined): SpaceId {
    if (!id || !isId<SpaceId>(id)) {
        throw createSpaceNotFoundError(id ?? undefined);
    }

    return id;
}

export function deserializeBotIdForLoader(id: string | null | undefined): BotId {
    if (!id || !isId<BotId>(id)) {
        throw createBotNotFoundError(id ?? undefined);
    }

    return id;
}

export function deserializeSiteIdForLoader(id: string | null | undefined): SiteId {
    if (!id || !isId<SiteId>(id)) {
        throw createSiteNotFoundError(id ?? undefined);
    }

    return id;
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
                message: errorDisplayMessage`This message doesn\u2019t exist. Try searching \u201Cmy messages\u201D to see messages you\u2019ve created.`,
                comment: errorDisplayMessage`This comment doesn\u2019t exist. Try searching \u201Cmy comments\u201D to see comments you\u2019ve created.`,
            }[messageNoun],
        });
    }

    return indexNumber;
}
