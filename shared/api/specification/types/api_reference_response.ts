import {ApiTaskStatus} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    AccountId,
    BotId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";

export type ApiReferenceResponse =
    | {
          readonly type: "Account";
          readonly id: AccountId;
          readonly title: string;
          readonly shortName: string;
          readonly bot?: {readonly id: BotId};
      }
    | {
          readonly type: "Channel";
          readonly id: ChannelId;
          readonly title: string;
      }
    | {
          readonly type: "Chat";
          readonly id: ChatId;
          readonly title: string;
      }
    | {
          readonly type: "ChatMessage";
          readonly id: ChatId;
          readonly index: number;
          readonly title: null;
      }
    | {
          readonly type: "Document";
          readonly id: DocumentId;
          readonly title: string;
      }
    | {
          readonly type: "DocumentMessage";
          readonly id: DocumentId;
          readonly threadId: DocumentCommentThreadId;
          readonly index: number;
          readonly title: null;
      }
    | {
          readonly type: "Post";
          readonly id: PostId;
          readonly title: string;
      }
    | {
          readonly type: "PostMessage";
          readonly id: PostId;
          readonly index: number;
          readonly title: null;
      }
    | {
          readonly type: "Task";
          readonly id: TaskId;
          readonly title: string;
          readonly status: ApiTaskStatus;
      }
    | {
          readonly type: "TaskMessage";
          readonly id: TaskId;
          readonly index: number;
          readonly title: null;
      }
    | {
          readonly type: "TaskCollection";
          readonly id: TaskCollectionId;
          readonly title: string;
      };
