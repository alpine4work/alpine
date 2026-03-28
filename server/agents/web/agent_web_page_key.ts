import {InternalError} from "~/shared/error/error.js";
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

export type AgentWebPageKey =
    | `Account:${AccountId}`
    | `Channel:${ChannelId}`
    | `ChatMessages:${ChatId}`
    | `Document:${DocumentId}`
    | `DocumentMessages:${DocumentId}-${DocumentCommentThreadId}`
    | `PostMessages:${PostId}`
    | `Task:${TaskId}`
    | `TaskMessages:${TaskId}`
    | `TaskCollection:${TaskCollectionId}`;

export type AgentWebPageKeyObject =
    | {
          readonly type: "Account";
          readonly id: AccountId;
      }
    | {
          readonly type: "Channel";
          readonly id: ChannelId;
      }
    | {
          readonly type: "ChatMessages";
          readonly id: ChatId;
      }
    | {
          readonly type: "Document";
          readonly id: DocumentId;
      }
    | {
          readonly type: "DocumentMessages";
          readonly id: DocumentId;
          readonly threadId: DocumentCommentThreadId;
      }
    | {
          readonly type: "PostMessages";
          readonly id: PostId;
      }
    | {
          readonly type: "Task";
          readonly id: TaskId;
      }
    | {
          readonly type: "TaskMessages";
          readonly id: TaskId;
      }
    | {
          readonly type: "TaskCollection";
          readonly id: TaskCollectionId;
      };

export function printAgentWebPageKey(key: AgentWebPageKeyObject): AgentWebPageKey {
    switch (key.type) {
        case "Account":
            return `Account:${key.id}`;
        case "Channel":
            return `Channel:${key.id}`;
        case "ChatMessages":
            return `ChatMessages:${key.id}`;
        case "Document":
            return `Document:${key.id}`;
        case "DocumentMessages":
            return `DocumentMessages:${key.id}-${key.threadId}`;
        case "PostMessages":
            return `PostMessages:${key.id}`;
        case "Task":
            return `Task:${key.id}`;
        case "TaskMessages":
            return `TaskMessages:${key.id}`;
        case "TaskCollection":
            return `TaskCollection:${key.id}`;
        default:
            throw exhaustive(key);
    }
}

export function parseAgentWebPageKey(key: AgentWebPageKey): AgentWebPageKeyObject {
    const [type = "", data = ""] = key.split(":", 2);

    switch (type) {
        case "Account":
            return {type: "Account", id: assertId<AccountId>(data)};

        case "Channel":
            return {type: "Channel", id: assertId<ChannelId>(data)};

        case "ChatMessages":
            return {type: "ChatMessages", id: assertId<ChatId>(data)};

        case "Document":
            return {type: "Document", id: assertId<DocumentId>(data)};

        case "DocumentMessages": {
            const [data1 = "", data2 = ""] = data.split("-", 2);

            return {
                type: "DocumentMessages",
                id: assertId<DocumentId>(data1),
                threadId: assertId<DocumentCommentThreadId>(data2),
            };
        }

        case "PostMessages":
            return {type: "PostMessages", id: assertId<PostId>(data)};

        case "Task":
            return {type: "Task", id: assertId<TaskId>(data)};

        case "TaskMessages":
            return {type: "TaskMessages", id: assertId<TaskId>(data)};

        case "TaskCollection":
            return {type: "TaskCollection", id: assertId<TaskCollectionId>(data)};

        default:
            throw new InternalError("Unrecognized `AgentWebPageKey` type");
    }
}
