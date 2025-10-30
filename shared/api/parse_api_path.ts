import {
    ApiMentionPath,
    ApiMessageRoomPath,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {getObjectKeysWithKeyofType} from "~/shared/helpers/object/get_object_keys_with_keyof_type.js";
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

export type ApiMessageRoomMessagesListPath = `${ApiMessageRoomPath}/messages`;

/**
 * A parsed object representation of `ApiContentMentionInlineElementTargetPath`.
 */
export type ApiMentionPathObject = ApiContentFilteredPathObjectType<ApiMentionPath>;

// All `ApiPath`s excluding mentionable paths
// (`ApiContentMentionInlineElementTargetPathObject`).
type ApiNotMentionPath = Exclude<ApiPath, ApiMentionPath>;

export type ApiNotMentionPathObject = ApiContentFilteredPathObjectType<ApiNotMentionPath>;

export type ApiContentFilteredPathObjectType<Path extends ApiPath> =
    ApiContentFilteredPathObjectTypeInner<Path, ApiPathsType>;

type ApiContentFilteredPathObjectTypeInner<
    Path extends ApiPath,
    Paths extends Array<{path: string; pathObject: object}>,
> = {
    [Key in keyof Paths]: Paths[Key]["path"] extends Path ? Paths[Key]["pathObject"] : never;
}[number];

const apiMentionPathObjectTypes = new Set<string>(
    getObjectKeysWithKeyofType(
        cast<Record<ApiMentionPathObject["type"], true>>({
            Account: true,
            Channel: true,
            Document: true,
            Post: true,
            Task: true,
            TaskCollection: true,
        }),
    ),
);

const apiMessageRoomPathObjectTypes = new Set<string>(
    getObjectKeysWithKeyofType(
        cast<Record<ApiMessageRoomPathObject["type"], true>>({
            Chat: true,
            Post: true,
            DocumentCommentThread: true,
            Task: true,
        }),
    ),
);

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
        path: `/chats/${ChatId}/messages`;
        pathObject: {readonly type: "ChatMessages"; readonly chatId: ChatId};
    },
    {
        path: `/chats/${ChatId}/messages/${number}`;
        pathObject: {readonly type: "ChatMessage"; readonly chatId: ChatId; messageIndex: number};
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
        path: `/documents/${DocumentId}/threads/${DocumentCommentThreadId}/messages`;
        pathObject: {
            readonly type: "DocumentCommentThreadComments";
            readonly documentId: DocumentId;
            readonly commentThreadId: DocumentCommentThreadId;
        };
    },
    {
        path: `/documents/${DocumentId}/threads/${DocumentCommentThreadId}/messages/${number}`;
        pathObject: {
            readonly type: "DocumentComment";
            readonly documentId: DocumentId;
            readonly commentThreadId: DocumentCommentThreadId;
            readonly commentIndex: number;
        };
    },
    {
        path: `/posts/${PostId}`;
        pathObject: {readonly type: "Post"; readonly postId: PostId};
    },
    {
        path: `/posts/${PostId}/messages`;
        pathObject: {readonly type: "PostComments"; readonly postId: PostId};
    },
    {
        path: `/posts/${PostId}/messages/${number}`;
        pathObject: {
            readonly type: "PostComment";
            readonly postId: PostId;
            readonly commentIndex: number;
        };
    },
    {
        path: `/tasks/${TaskId}`;
        pathObject: {readonly type: "Task"; readonly taskId: TaskId};
    },
    {
        path: `/tasks/${TaskId}/messages`;
        pathObject: {readonly type: "TaskComments"; readonly taskId: TaskId};
    },
    {
        path: `/tasks/${TaskId}/messages/${number}`;
        pathObject: {
            readonly type: "TaskComment";
            readonly taskId: TaskId;
            readonly commentIndex: number;
        };
    },
    {
        path: `/task-collections/${TaskCollectionId}`;
        pathObject: {readonly type: "TaskCollection"; readonly collectionId: TaskCollectionId};
    },
];

export function parseApiPath(path: string): ApiPathObject {
    if (!path.startsWith("/")) {
        throw new InvalidArgumentError("Path doesn’t start with `/`", {
            displayMessage: getDisplayMessage(),
        });
    }

    const pathSegments = path.slice(1).split("/");

    if (pathSegments.length < 2) {
        throw new InvalidArgumentError("Path doesn’t have at least two path segments", {
            displayMessage: getDisplayMessage(),
        });
    }

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

            if (pathSegments[2] === "messages") {
                if (pathSegments.length === 3) {
                    return {type: "ChatMessages", chatId: pathSegments[1]};
                }

                if (pathSegments.length !== 4) {
                    throw new InvalidArgumentError("Expected four path segments", {
                        displayMessage: getDisplayMessage(),
                    });
                }

                const messageIndex = parseMessageIndexIfExists(pathSegments[3]!);
                if (typeof messageIndex !== "number") {
                    throw new InvalidArgumentError(
                        "Fourth path segment isn’t a valid message index",
                        {
                            displayMessage: getDisplayMessage(),
                        },
                    );
                }
                return {
                    type: "ChatMessage",
                    chatId: pathSegments[1],
                    messageIndex,
                };
            } else if (pathSegments.length > 2) {
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

                const threadOptionsBase = {
                    documentId: pathSegments[1],
                    commentThreadId: pathSegments[3],
                } as const;

                if (pathSegments[4] === "messages") {
                    if (pathSegments[5]) {
                        if (pathSegments.length !== 6) {
                            throw new InvalidArgumentError("Expected six path segments", {
                                displayMessage: getDisplayMessage(),
                            });
                        }

                        const commentIndex = parseMessageIndexIfExists(pathSegments[5]);
                        if (typeof commentIndex !== "number") {
                            throw new InvalidArgumentError(
                                "Sixth path segment isn’t a valid message index",
                                {
                                    displayMessage: getDisplayMessage(),
                                },
                            );
                        }

                        return {
                            type: "DocumentComment",
                            ...threadOptionsBase,
                            commentIndex,
                        };
                    }

                    if (pathSegments.length !== 5) {
                        throw new InvalidArgumentError("Expected five path segments", {
                            displayMessage: getDisplayMessage(),
                        });
                    }

                    return {
                        type: "DocumentCommentThreadComments",
                        ...threadOptionsBase,
                    };
                }

                if (pathSegments.length !== 4) {
                    throw new InvalidArgumentError("Expected four path segments", {
                        displayMessage: getDisplayMessage(),
                    });
                }

                return {
                    type: "DocumentCommentThread",
                    ...threadOptionsBase,
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

            if (pathSegments[2] === "messages") {
                if (pathSegments[3]) {
                    if (pathSegments.length !== 4) {
                        throw new InvalidArgumentError("Expected four path segments", {
                            displayMessage: getDisplayMessage(),
                        });
                    }

                    const commentIndex = parseMessageIndexIfExists(pathSegments[3]);
                    if (typeof commentIndex !== "number") {
                        throw new InvalidArgumentError(
                            "Fourth path segment isn’t a valid message index",
                            {
                                displayMessage: getDisplayMessage(),
                            },
                        );
                    }

                    return {
                        type: "PostComment",
                        postId: pathSegments[1],
                        commentIndex,
                    };
                }

                if (pathSegments.length !== 3) {
                    throw new InvalidArgumentError("Expected three path segments", {
                        displayMessage: getDisplayMessage(),
                    });
                }

                return {
                    type: "PostComments",
                    postId: pathSegments[1],
                };
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

            if (pathSegments[2] === "messages") {
                if (pathSegments[3]) {
                    if (pathSegments.length !== 4) {
                        throw new InvalidArgumentError("Expected four path segments", {
                            displayMessage: getDisplayMessage(),
                        });
                    }

                    const commentIndex = parseMessageIndexIfExists(pathSegments[3]);
                    if (typeof commentIndex !== "number") {
                        throw new InvalidArgumentError(
                            "Fourth path segment isn’t a valid message index",
                            {
                                displayMessage: getDisplayMessage(),
                            },
                        );
                    }

                    return {
                        type: "TaskComment",
                        taskId: pathSegments[1],
                        commentIndex,
                    };
                }

                if (pathSegments.length !== 3) {
                    throw new InvalidArgumentError("Expected three path segments", {
                        displayMessage: getDisplayMessage(),
                    });
                }

                return {
                    type: "TaskComments",
                    taskId: pathSegments[1],
                };
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

export function printApiMentionPath(path: ApiMentionPathObject): ApiMentionPath {
    return printApiPath(path) as ApiMentionPath;
}

export function printApiPath(path: ApiPathObject): ApiPath {
    switch (path.type) {
        case "Account":
            return `/accounts/${path.accountId}`;
        case "Channel":
            return `/channels/${path.channelId}`;
        case "Chat":
            return `/chats/${path.chatId}`;
        case "ChatMessage":
            return `/chats/${path.chatId}/messages/${path.messageIndex}`;
        case "ChatMessages":
            return `/chats/${path.chatId}/messages`;
        case "Document":
            return `/documents/${path.documentId}`;
        case "DocumentCommentThread":
            return `/documents/${path.documentId}/threads/${path.commentThreadId}`;
        case "DocumentComment":
            return `/documents/${path.documentId}/threads/${path.commentThreadId}/messages/${path.commentIndex}`;
        case "DocumentCommentThreadComments":
            return `/documents/${path.documentId}/threads/${path.commentThreadId}/messages`;
        case "Post":
            return `/posts/${path.postId}`;
        case "PostComment":
            return `/posts/${path.postId}/messages/${path.commentIndex}`;
        case "PostComments":
            return `/posts/${path.postId}/messages`;
        case "Task":
            return `/tasks/${path.taskId}`;
        case "TaskComment":
            return `/tasks/${path.taskId}/messages/${path.commentIndex}`;
        case "TaskComments":
            return `/tasks/${path.taskId}/messages`;
        case "TaskCollection":
            return `/task-collections/${path.collectionId}`;
        default:
            throw exhaustive(path);
    }
}

function parseMessageIndexIfExists(messageIndexString: string): number | null {
    if (!/^([0-9]|[1-9][0-9]+)$/.test(messageIndexString)) {
        return null;
    }

    const messageIndex = parseInt(messageIndexString, 10);
    return Number.isSafeInteger(messageIndex) && messageIndex >= 0 ? messageIndex : null;
}

export function isApiMessageRoomPath(path: ApiPath): path is ApiMessageRoomPath {
    const pathObject = parseApiPath(path);
    return isApiMessageRoomPathObject(pathObject);
}

export function isApiMessageRoomPathObject(
    pathObject: ApiPathObject,
): pathObject is ApiMessageRoomPathObject {
    return apiMessageRoomPathObjectTypes.has(pathObject.type);
}

export function parseApiMessageRoomPath(path: ApiMessageRoomPath): ApiMessageRoomPathObject {
    return parseApiPath(path) as ApiMessageRoomPathObject;
}

export function parseApiMentionPath(path: ApiMentionPath): ApiMentionPathObject {
    return parseApiPath(path) as ApiMentionPathObject;
}

export function parseApiNotMentionPath(path: ApiNotMentionPath): ApiNotMentionPathObject {
    return parseApiPath(path) as ApiNotMentionPathObject;
}

export function isApiMentionPath(path: ApiPath): path is ApiMentionPath {
    const pathObject = parseApiPath(path);
    return apiMentionPathObjectTypes.has(pathObject.type);
}

export function isApiNotMentionPath(path: ApiPath): path is ApiNotMentionPath {
    return !isApiMentionPath(path);
}

export function getApiMentionPathIfExists(path: ApiPath): ApiMentionPath | null {
    if (isApiMentionPath(path)) return path;

    const pathObject = parseApiNotMentionPath(path);

    switch (pathObject.type) {
        case "DocumentCommentThread":
        case "DocumentComment":
        case "DocumentCommentThreadComments": {
            return `/documents/${pathObject.documentId}`;
        }
        case "PostComment":
        case "PostComments": {
            return `/posts/${pathObject.postId}`;
        }
        case "TaskComment":
        case "TaskComments": {
            return `/tasks/${pathObject.taskId}`;
        }
        case "Chat":
        case "ChatMessage":
        case "ChatMessages": {
            return null;
        }
        default: {
            throw exhaustive(pathObject);
        }
    }
}
