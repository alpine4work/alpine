import {
    ApiMentionReferenceKey,
    parseApiMentionReferenceKey,
    printApiMentionReferenceKey,
} from "~/shared/api/specification/api_mention_reference_key.open_source.js";
import {ApiMentionReference} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {assertId} from "~/shared/id/id.open_source.js";
import {
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    FileId,
    PostId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";

/**
 * See `AgentWebPageStoredLink` for more information on what this is.
 */
export type AgentWebPageStoredLinkKey =
    | ApiMentionReferenceKey
    | `ChatMessage:${ChatId}-${number}`
    | `DocumentMessage:${DocumentId}-${DocumentCommentThreadId}-${number}`
    | `PostMessage:${PostId}-${number}`
    | `TaskMessage:${TaskId}-${number}`
    | `File:${FileId}`;

export type AgentWebPageStoredLinkKeyObject =
    | ApiMentionReference
    | {
          readonly type: "ChatMessage";
          readonly id: ChatId;
          readonly index: number;
      }
    | {
          readonly type: "DocumentMessage";
          readonly id: DocumentId;
          readonly threadId: DocumentCommentThreadId;
          readonly index: number;
      }
    | {
          readonly type: "PostMessage";
          readonly id: PostId;
          readonly index: number;
      }
    | {
          readonly type: "TaskMessage";
          readonly id: TaskId;
          readonly index: number;
      }
    | {
          readonly type: "File";
          readonly id: FileId;
      };

export function printAgentWebPageStoredLinkKey(
    key: AgentWebPageStoredLinkKeyObject,
): AgentWebPageStoredLinkKey {
    switch (key.type) {
        case "ChatMessage":
            return `ChatMessage:${key.id}-${key.index}`;
        case "DocumentMessage":
            return `DocumentMessage:${key.id}-${key.threadId}-${key.index}`;
        case "PostMessage":
            return `PostMessage:${key.id}-${key.index}`;
        case "TaskMessage":
            return `TaskMessage:${key.id}-${key.index}`;
        case "File":
            return `File:${key.id}`;
        default:
            return printApiMentionReferenceKey(key);
    }
}

export function parseAgentWebPageStoredLinkKey(
    key: AgentWebPageStoredLinkKey,
): AgentWebPageStoredLinkKeyObject {
    const [type = "", data = ""] = key.split(":", 2);

    switch (type) {
        case "ChatMessage": {
            const [data1 = "", data2 = ""] = data.split("-", 2);
            return {
                type: "ChatMessage",
                id: assertId<ChatId>(data1),
                index: parseInt(data2, 10),
            };
        }

        case "DocumentMessage": {
            const [data1 = "", data2 = "", data3 = ""] = data.split("-", 3);

            return {
                type: "DocumentMessage",
                id: assertId<DocumentId>(data1),
                threadId: assertId<DocumentCommentThreadId>(data2),
                index: parseInt(data3, 10),
            };
        }

        case "PostMessage": {
            const [data1 = "", data2 = ""] = data.split("-", 2);
            return {
                type: "PostMessage",
                id: assertId<PostId>(data1),
                index: parseInt(data2, 10),
            };
        }

        case "TaskMessage": {
            const [data1 = "", data2 = ""] = data.split("-", 2);
            return {
                type: "TaskMessage",
                id: assertId<TaskId>(data1),
                index: parseInt(data2, 10),
            };
        }

        default:
            return parseApiMentionReferenceKey(key as ApiMentionReferenceKey);
    }
}
