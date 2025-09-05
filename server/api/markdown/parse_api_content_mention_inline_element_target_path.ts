import {ApiContentMentionInlineElementTargetPath} from "~/server/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    DocumentId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";

export type ApiContentMentionInlineElementTargetPathObject =
    | {readonly type: "Account"; readonly accountId: AccountId}
    | {readonly type: "Channel"; readonly channelId: ChannelId}
    | {readonly type: "Document"; readonly documentId: DocumentId}
    | {readonly type: "Post"; readonly postId: PostId}
    | {readonly type: "Task"; readonly taskId: TaskId}
    | {readonly type: "TaskCollection"; readonly collectionId: TaskCollectionId};

export function parseApiContentMentionInlineElementTargetPath(
    path: ApiContentMentionInlineElementTargetPath,
): ApiContentMentionInlineElementTargetPathObject {
    if (!path.startsWith("/")) {
        throw new InvalidArgumentError("Path doesn’t start with `/`", {
            displayMessage: getDisplayMessage(),
        });
    }

    const pathSegments = path.slice(1).split("/");

    switch (pathSegments[0]) {
        case "accounts": {
            if (pathSegments.length !== 2) {
                throw new InvalidArgumentError("Expected two path segments", {
                    displayMessage: getDisplayMessage(),
                });
            }

            if (!isId<AccountId>(pathSegments[1]!)) {
                throw new InvalidArgumentError("Second path segment isn’t an `Id`", {
                    displayMessage: getDisplayMessage(),
                });
            }

            return {type: "Account", accountId: pathSegments[1]};
        }
        case "documents": {
            if (pathSegments.length !== 2) {
                throw new InvalidArgumentError("Expected two path segments", {
                    displayMessage: getDisplayMessage(),
                });
            }

            if (!isId<DocumentId>(pathSegments[1]!)) {
                throw new InvalidArgumentError("Second path segment isn’t an `Id`", {
                    displayMessage: getDisplayMessage(),
                });
            }

            return {type: "Document", documentId: pathSegments[1]};
        }
        case "channels": {
            if (pathSegments.length !== 2) {
                throw new InvalidArgumentError("Expected two path segments", {
                    displayMessage: getDisplayMessage(),
                });
            }

            if (!isId<ChannelId>(pathSegments[1]!)) {
                throw new InvalidArgumentError("Second path segment isn’t an `Id`", {
                    displayMessage: getDisplayMessage(),
                });
            }

            return {type: "Channel", channelId: pathSegments[1]};
        }
        case "tasks": {
            if (pathSegments.length !== 2) {
                throw new InvalidArgumentError("Expected two path segments", {
                    displayMessage: getDisplayMessage(),
                });
            }

            if (!isId<TaskId>(pathSegments[1]!)) {
                throw new InvalidArgumentError("Second path segment isn’t an `Id`", {
                    displayMessage: getDisplayMessage(),
                });
            }

            return {type: "Task", taskId: pathSegments[1]};
        }
        case "task-collections": {
            if (pathSegments.length !== 2) {
                throw new InvalidArgumentError("Expected two path segments", {
                    displayMessage: getDisplayMessage(),
                });
            }

            if (!isId<TaskCollectionId>(pathSegments[1]!)) {
                throw new InvalidArgumentError("Second path segment isn’t an `Id`", {
                    displayMessage: getDisplayMessage(),
                });
            }

            return {type: "TaskCollection", collectionId: pathSegments[1]};
        }
        case "posts": {
            if (pathSegments.length !== 2) {
                throw new InvalidArgumentError("Expected two path segments", {
                    displayMessage: getDisplayMessage(),
                });
            }

            if (!isId<PostId>(pathSegments[1]!)) {
                throw new InvalidArgumentError("Second path segment isn’t an `Id`", {
                    displayMessage: getDisplayMessage(),
                });
            }

            return {type: "Post", postId: pathSegments[1]};
        }
        default: {
            throw new InvalidArgumentError("Unrecognized first path segment", {
                displayMessage: getDisplayMessage(),
            });
        }
    }

    function getDisplayMessage() {
        return errorDisplayMessage`Invalid mention target path: “${path}”.`;
    }
}

export function printApiContentMentionInlineElementTargetPath(
    path: ApiContentMentionInlineElementTargetPathObject,
): ApiContentMentionInlineElementTargetPath {
    switch (path.type) {
        case "Account":
            return `/accounts/${path.accountId}`;
        case "Channel":
            return `/channels/${path.channelId}`;
        case "Document":
            return `/documents/${path.documentId}`;
        case "Post":
            return `/posts/${path.postId}`;
        case "Task":
            return `/tasks/${path.taskId}`;
        case "TaskCollection":
            return `/task-collections/${path.collectionId}`;
        default:
            throw exhaustive(path);
    }
}
