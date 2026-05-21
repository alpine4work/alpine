import type {ApiTarget} from "~/shared/api/specification/types/api_target.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {assertId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";

export type ApiTargetKey =
    | `Account:${AccountId}`
    | `Channel:${ChannelId}`
    | `Chat:${ChatId}`
    | `ChatMessage:${ChatId}-${number}`
    | `Document:${DocumentId}`
    | `DocumentMessage:${DocumentId}-${DocumentCommentThreadId}-${number}`
    | `Post:${PostId}`
    | `PostMessage:${PostId}-${number}`
    | `Task:${TaskId}`
    | `TaskMessage:${TaskId}-${number}`
    | `TaskCollection:${TaskCollectionId}`;

export function printApiTargetKey(key: ApiTarget): ApiTargetKey {
    switch (key.type) {
        case "Account":
            return `Account:${key.id}`;
        case "Channel":
            return `Channel:${key.id}`;
        case "Chat":
            return `Chat:${key.id}`;
        case "ChatMessage":
            return `ChatMessage:${key.id}-${key.index}`;
        case "Document":
            return `Document:${key.id}`;
        case "DocumentMessage":
            return `DocumentMessage:${key.id}-${key.threadId}-${key.index}`;
        case "Post":
            return `Post:${key.id}`;
        case "PostMessage":
            return `PostMessage:${key.id}-${key.index}`;
        case "Task":
            return `Task:${key.id}`;
        case "TaskMessage":
            return `TaskMessage:${key.id}-${key.index}`;
        case "TaskCollection":
            return `TaskCollection:${key.id}`;
        default:
            throw exhaustive(key);
    }
}

export function parseApiTargetKey(key: ApiTargetKey): ApiTarget {
    const [type = "", data = ""] = key.split(":", 2);

    switch (type) {
        case "Account":
            return {type: "Account", id: assertId<AccountId>(data)};

        case "Channel":
            return {type: "Channel", id: assertId<ChannelId>(data)};

        case "Chat":
            return {type: "Chat", id: assertId<ChatId>(data)};

        case "ChatMessage": {
            const [data1 = "", data2 = ""] = data.split("-", 2);
            return {
                type: "ChatMessage",
                id: assertId<ChatId>(data1),
                index: parseInt(data2, 10),
            };
        }

        case "Document":
            return {type: "Document", id: assertId<DocumentId>(data)};

        case "DocumentMessage": {
            const [data1 = "", data2 = "", data3 = ""] = data.split("-", 3);

            return {
                type: "DocumentMessage",
                id: assertId<DocumentId>(data1),
                threadId: assertId<DocumentCommentThreadId>(data2),
                index: parseInt(data3, 10),
            };
        }

        case "Post":
            return {type: "Post", id: assertId<PostId>(data)};

        case "PostMessage": {
            const [data1 = "", data2 = ""] = data.split("-", 2);
            return {
                type: "PostMessage",
                id: assertId<PostId>(data1),
                index: parseInt(data2, 10),
            };
        }

        case "Task":
            return {type: "Task", id: assertId<TaskId>(data)};

        case "TaskMessage": {
            const [data1 = "", data2 = ""] = data.split("-", 2);
            return {
                type: "TaskMessage",
                id: assertId<TaskId>(data1),
                index: parseInt(data2, 10),
            };
        }

        case "TaskCollection":
            return {type: "TaskCollection", id: assertId<TaskCollectionId>(data)};

        default:
            throw new InvalidArgumentError("Unrecognized `ApiTargetKey` type");
    }
}
