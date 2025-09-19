import {
    ApiContentMentionInlineElementTargetPath,
    ApiMessageRoomPath,
} from "~/server/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isId} from "~/shared/id/id.js";
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

/**
 * Any API path supported by our system.
 */
export type ApiPath = ApiPathsType[number]["path"];

/**
 * A parsed object representation of an API path in our system.
 */
export type ApiPathObject = ApiPathsType[number]["pathObject"];

/**
 * A parsed object representation of `ApiMessageRoomPath`.
 */
export type ApiMessageRoomPathObject = ApiContentFilteredPathObjectType<ApiMessageRoomPath>;

/**
 * A parsed object representation of `ApiContentMentionInlineElementTargetPath`.
 */
export type ApiContentMentionInlineElementTargetPathObject =
    ApiContentFilteredPathObjectType<ApiContentMentionInlineElementTargetPath>;

type ApiContentFilteredPathObjectType<Path extends ApiPath> = ApiContentFilteredPathObjectTypeInner<
    Path,
    ApiPathsType
>;

type ApiContentFilteredPathObjectTypeInner<
    Path extends ApiPath,
    Paths extends Array<{path: string; pathObject: object}>,
> = {
    [Key in keyof Paths]: Paths[Key]["path"] extends Path ? Paths[Key]["pathObject"] : never;
}[number];

type ApiPathsType = [
    {
        path: `/accounts/${AccountId}`;
        pathObject: {readonly type: "Account"; readonly accountId: AccountId};
    },
    {
        path: `/channels/${ChannelId}`;
        pathObject: {readonly type: "Channel"; readonly channelId: ChannelId};
    },
    {
        path: `/chats/${ChatId}`;
        pathObject: {readonly type: "Chat"; readonly chatId: ChatId};
    },
    {
        path: `/documents/${DocumentId}`;
        pathObject: {readonly type: "Document"; readonly documentId: DocumentId};
    },
    {
        path: `/documents/${DocumentId}/threads/${DocumentCommentThreadId}`;
        pathObject: {
            readonly type: "DocumentCommentThread";
            readonly documentId: DocumentId;
            readonly commentThreadId: DocumentCommentThreadId;
        };
    },
    {
        path: `/posts/${PostId}`;
        pathObject: {readonly type: "Post"; readonly postId: PostId};
    },
    {
        path: `/tasks/${TaskId}`;
        pathObject: {readonly type: "Task"; readonly taskId: TaskId};
    },
    {
        path: `/task-collections/${TaskCollectionId}`;
        pathObject: {readonly type: "TaskCollection"; readonly collectionId: TaskCollectionId};
    },
];

export function parseApiMessageRoomPath(path: ApiMessageRoomPath): ApiMessageRoomPathObject {
    return parseApiPath(path) as ApiMessageRoomPathObject;
}

export function parseApiContentMentionInlineElementTargetPath(
    path: ApiContentMentionInlineElementTargetPath,
): ApiContentMentionInlineElementTargetPathObject {
    return parseApiPath(path) as ApiContentMentionInlineElementTargetPathObject;
}

export function parseApiPath(path: ApiPath): ApiPathObject {
    if (!path.startsWith("/")) {
        throw new InvalidArgumentError("Path doesn’t start with `/`", {
            displayMessage: getDisplayMessage(),
        });
    }

    const pathSegments = path.slice(1).split("/");

    switch (pathSegments[0]) {
        case "accounts": {
            if (!isId<AccountId>(pathSegments[1]!)) {
                throw new InvalidArgumentError("Second path segment isn’t an `Id`", {
                    displayMessage: getDisplayMessage(),
                });
            }

            if (pathSegments.length !== 2) {
                throw new InvalidArgumentError("Expected two path segments", {
                    displayMessage: getDisplayMessage(),
                });
            }

            return {type: "Account", accountId: pathSegments[1]};
        }
        case "channels": {
            if (!isId<ChannelId>(pathSegments[1]!)) {
                throw new InvalidArgumentError("Second path segment isn’t an `Id`", {
                    displayMessage: getDisplayMessage(),
                });
            }

            if (pathSegments.length !== 2) {
                throw new InvalidArgumentError("Expected two path segments", {
                    displayMessage: getDisplayMessage(),
                });
            }

            return {type: "Channel", channelId: pathSegments[1]};
        }
        case "chats": {
            if (!isId<ChatId>(pathSegments[1]!)) {
                throw new InvalidArgumentError("Second path segment isn’t an `Id`", {
                    displayMessage: getDisplayMessage(),
                });
            }

            if (pathSegments.length !== 2) {
                throw new InvalidArgumentError("Expected two path segments", {
                    displayMessage: getDisplayMessage(),
                });
            }

            return {type: "Chat", chatId: pathSegments[1]};
        }
        case "documents": {
            if (!isId<DocumentId>(pathSegments[1]!)) {
                throw new InvalidArgumentError("Second path segment isn’t an `Id`", {
                    displayMessage: getDisplayMessage(),
                });
            }

            if (pathSegments[2] === "threads") {
                if (!isId<DocumentCommentThreadId>(pathSegments[3]!)) {
                    throw new InvalidArgumentError("Fourth path segment isn’t an `Id`", {
                        displayMessage: getDisplayMessage(),
                    });
                }

                if (pathSegments.length !== 4) {
                    throw new InvalidArgumentError("Expected four path segments", {
                        displayMessage: getDisplayMessage(),
                    });
                }

                return {
                    type: "DocumentCommentThread",
                    documentId: pathSegments[1],
                    commentThreadId: pathSegments[3],
                };
            } else {
                if (pathSegments.length !== 2) {
                    throw new InvalidArgumentError("Expected two path segments", {
                        displayMessage: getDisplayMessage(),
                    });
                }

                return {type: "Document", documentId: pathSegments[1]};
            }
        }
        case "posts": {
            if (!isId<PostId>(pathSegments[1]!)) {
                throw new InvalidArgumentError("Second path segment isn’t an `Id`", {
                    displayMessage: getDisplayMessage(),
                });
            }

            if (pathSegments.length !== 2) {
                throw new InvalidArgumentError("Expected two path segments", {
                    displayMessage: getDisplayMessage(),
                });
            }

            return {type: "Post", postId: pathSegments[1]};
        }
        case "tasks": {
            if (!isId<TaskId>(pathSegments[1]!)) {
                throw new InvalidArgumentError("Second path segment isn’t an `Id`", {
                    displayMessage: getDisplayMessage(),
                });
            }

            if (pathSegments.length !== 2) {
                throw new InvalidArgumentError("Expected two path segments", {
                    displayMessage: getDisplayMessage(),
                });
            }

            return {type: "Task", taskId: pathSegments[1]};
        }
        case "task-collections": {
            if (!isId<TaskCollectionId>(pathSegments[1]!)) {
                throw new InvalidArgumentError("Second path segment isn’t an `Id`", {
                    displayMessage: getDisplayMessage(),
                });
            }

            if (pathSegments.length !== 2) {
                throw new InvalidArgumentError("Expected two path segments", {
                    displayMessage: getDisplayMessage(),
                });
            }

            return {type: "TaskCollection", collectionId: pathSegments[1]};
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

export function printApiMessageRoomPath(path: ApiMessageRoomPathObject): ApiMessageRoomPath {
    return printApiPath(path) as ApiMessageRoomPath;
}

export function printApiContentMentionInlineElementTargetPath(
    path: ApiContentMentionInlineElementTargetPathObject,
): ApiContentMentionInlineElementTargetPath {
    return printApiPath(path) as ApiContentMentionInlineElementTargetPath;
}

export function printApiPath(path: ApiPathObject): ApiPath {
    switch (path.type) {
        case "Account":
            return `/accounts/${path.accountId}`;
        case "Channel":
            return `/channels/${path.channelId}`;
        case "Chat":
            return `/chats/${path.chatId}`;
        case "Document":
            return `/documents/${path.documentId}`;
        case "DocumentCommentThread":
            return `/documents/${path.documentId}/threads/${path.commentThreadId}`;
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
