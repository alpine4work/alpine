import {
    ApiAccountReference,
    ApiDocumentReference,
    ApiTaskReference,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {assertId} from "~/shared/id/id.open_source.js";
import {
    AccountId,
    DocumentCommentThreadId,
    DocumentId,
    TaskId,
} from "~/shared/id/types/id_types.open_source.js";

/**
 * See `AgentWebPageRoutedLink` for more information on what this is.
 */
export type AgentWebPageRoutedLinkKey =
    | `Skill:${string}`
    | `DocumentThread:${DocumentId}-${DocumentCommentThreadId}`
    | `TaskMessageList:${TaskId}`
    | `TaskSubtasks:${TaskId}`
    | `Inbox:${AccountId}`
    | "MyAccount";

export type AgentWebPageRoutedLinkKeyObject =
    | {
          readonly type: "Skill";
          readonly path: string;
      }
    | {
          readonly type: "DocumentThread";
          readonly document: ApiDocumentReference;
          readonly id: DocumentCommentThreadId;
      }
    | {
          readonly type: "TaskMessageList";
          readonly task: ApiTaskReference;
      }
    | {
          readonly type: "TaskSubtasks";
          readonly task: ApiTaskReference;
      }
    | {
          readonly type: "Inbox";
          readonly account: ApiAccountReference;
      }
    | {
          readonly type: "MyAccount";
      };

export function printAgentWebPageRoutedLinkKey(
    key: AgentWebPageRoutedLinkKeyObject,
): AgentWebPageRoutedLinkKey {
    switch (key.type) {
        case "Skill":
            return `Skill:${key.path}`;
        case "DocumentThread":
            return `DocumentThread:${key.document.id}-${key.id}`;
        case "TaskMessageList":
            return `TaskMessageList:${key.task.id}`;
        case "TaskSubtasks":
            return `TaskSubtasks:${key.task.id}`;
        case "Inbox":
            return `Inbox:${key.account.id}`;
        case "MyAccount":
            return "MyAccount";
        default:
            throw exhaustive(key);
    }
}

export function parseAgentWebPageRoutedLinkKey(
    key: AgentWebPageRoutedLinkKey,
): AgentWebPageRoutedLinkKeyObject {
    const [type = "", data = ""] = key.split(":", 2);

    switch (type) {
        case "Skill": {
            return {
                type: "Skill",
                path: data,
            };
        }

        case "DocumentThread": {
            const [documentId = "", threadId = ""] = data.split("-", 2);

            return {
                type: "DocumentThread",
                document: {
                    type: "Document",
                    id: assertId<DocumentId>(documentId),
                },
                id: assertId<DocumentCommentThreadId>(threadId),
            };
        }

        case "TaskMessageList": {
            return {
                type: "TaskMessageList",
                task: {type: "Task", id: assertId<TaskId>(data)},
            };
        }

        case "TaskSubtasks": {
            return {
                type: "TaskSubtasks",
                task: {type: "Task", id: assertId<TaskId>(data)},
            };
        }

        case "Inbox": {
            return {
                type: "Inbox",
                account: {type: "Account", id: assertId<AccountId>(data)},
            };
        }

        case "MyAccount": {
            return {type: "MyAccount"};
        }

        default:
            throw new InvalidArgumentError("Unrecognized `AgentWebPageRoutedLinkKey` type");
    }
}
