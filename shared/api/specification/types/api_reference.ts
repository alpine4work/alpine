import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SiteId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";

export type ApiReference =
    | {
          readonly type: "Account";
          readonly id: AccountId;
      }
    | {
          readonly type: "Channel";
          readonly id: ChannelId;
      }
    | {
          readonly type: "Chat";
          readonly id: ChatId;
      }
    | {
          readonly type: "ChatMessage";
          readonly id: ChatId;
          readonly index: number;
      }
    | {
          readonly type: "Document";
          readonly id: DocumentId;
      }
    | {
          readonly type: "DocumentMessage";
          readonly id: DocumentId;
          readonly threadId: DocumentCommentThreadId;
          readonly index: number;
      }
    | {
          readonly type: "Post";
          readonly id: PostId;
      }
    | {
          readonly type: "PostMessage";
          readonly id: PostId;
          readonly index: number;
      }
    | {
          readonly type: "Task";
          readonly id: TaskId;
      }
    | {
          readonly type: "TaskMessage";
          readonly id: TaskId;
          readonly index: number;
      }
    | {
          readonly type: "TaskCollection";
          readonly id: TaskCollectionId;
      }
    | {
          readonly type: "Site";
          readonly id: SiteId;
      };
