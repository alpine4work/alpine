import {
    ApiAccountPath,
    ApiChannelPath,
    ApiChatMessagePath,
    ApiChatPath,
    ApiDocumentMessagePath,
    ApiDocumentPath,
    ApiPostMessagePath,
    ApiPostPath,
    ApiTaskCollectionPath,
    ApiTaskMessagePath,
    ApiTaskPath,
} from "~/shared/api/types/api_specification_convenience_types.js";
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

export type ApiTarget =
    | {
          readonly type: "Account";
          readonly path: ApiAccountPath;
          readonly id: AccountId;
      }
    | {
          readonly type: "Channel";
          readonly path: ApiChannelPath;
          readonly id: ChannelId;
      }
    | {
          readonly type: "Chat";
          readonly path: ApiChatPath;
          readonly id: ChatId;
      }
    | {
          readonly type: "ChatMessage";
          readonly path: ApiChatMessagePath;
          readonly id: ChatId;
          readonly index: number;
      }
    | {
          readonly type: "Document";
          readonly path: ApiDocumentPath;
          readonly id: DocumentId;
      }
    | {
          readonly type: "DocumentMessage";
          readonly path: ApiDocumentMessagePath;
          readonly id: DocumentId;
          readonly threadId: DocumentCommentThreadId;
          readonly index: number;
      }
    | {
          readonly type: "Post";
          readonly path: ApiPostPath;
          readonly id: PostId;
      }
    | {
          readonly type: "PostMessage";
          readonly path: ApiPostMessagePath;
          readonly id: PostId;
          readonly index: number;
      }
    | {
          readonly type: "Task";
          readonly path: ApiTaskPath;
          readonly id: TaskId;
      }
    | {
          readonly type: "TaskMessage";
          readonly path: ApiTaskMessagePath;
          readonly id: TaskId;
          readonly index: number;
      }
    | {
          readonly type: "TaskCollection";
          readonly path: ApiTaskCollectionPath;
          readonly id: TaskCollectionId;
      };
