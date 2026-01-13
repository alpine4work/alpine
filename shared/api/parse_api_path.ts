import {
    ApiBotWebhookEvent,
    ApiMentionPath,
    ApiMentionTarget,
    ApiMentionTargetResponse,
    ApiMessageRoomPath,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {getObjectKeysWithKeyofType} from "~/shared/helpers/object/get_object_keys_with_keyof_type.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
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

// TODO(calebmer): Consolidate `ApiTarget` and `ApiPathObject` someday?
assertAssignableTypes<ApiMentionTargetResponse, ApiMentionPathObject>();

/**
 * A parsed object representation of `ApiMessageRoomPath`.
 */
export type ApiMessageRoomPathObject = ApiContentFilteredPathObjectType<ApiMessageRoomPath>;

export type ApiMessageRoomMessagesListPath = `${ApiMessageRoomPath}/messages`;

/**
 * A parsed object representation of `ApiMentionPath`.
 */
export type ApiMentionPathObject = ApiContentFilteredPathObjectType<ApiMentionPath>;

// All `ApiPath`s excluding mentionable paths (`ApiMentionPathObject`).
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
        pathObject: {readonly type: "Account"; readonly id: AccountId};
    },
    {
        path: `/channels/${ChannelId}`;
        pathObject: {readonly type: "Channel"; readonly id: ChannelId};
    },
    {
        path: `/chats/${ChatId}`;
        pathObject: {readonly type: "Chat"; readonly id: ChatId};
    },
    {
        path: `/chats/${ChatId}/messages`;
        pathObject: {readonly type: "ChatMessages"; readonly id: ChatId};
    },
    {
        path: `/chats/${ChatId}/messages/${number}`;
        pathObject: {readonly type: "ChatMessage"; readonly id: ChatId; index: number};
    },
    {
        path: `/documents/${DocumentId}`;
        pathObject: {readonly type: "Document"; readonly id: DocumentId};
    },
    {
        path: `/documents/${DocumentId}/threads/${DocumentCommentThreadId}`;
        pathObject: {
            readonly type: "DocumentCommentThread";
            readonly id: DocumentId;
            readonly threadId: DocumentCommentThreadId;
        };
    },
    {
        path: `/documents/${DocumentId}/threads/${DocumentCommentThreadId}/messages`;
        pathObject: {
            readonly type: "DocumentCommentThreadComments";
            readonly id: DocumentId;
            readonly threadId: DocumentCommentThreadId;
        };
    },
    {
        path: `/documents/${DocumentId}/threads/${DocumentCommentThreadId}/messages/${number}`;
        pathObject: {
            readonly type: "DocumentComment";
            readonly id: DocumentId;
            readonly threadId: DocumentCommentThreadId;
            readonly index: number;
        };
    },
    {
        path: `/posts/${PostId}`;
        pathObject: {readonly type: "Post"; readonly id: PostId};
    },
    {
        path: `/posts/${PostId}/messages`;
        pathObject: {readonly type: "PostComments"; readonly id: PostId};
    },
    {
        path: `/posts/${PostId}/messages/${number}`;
        pathObject: {readonly type: "PostComment"; readonly id: PostId; readonly index: number};
    },
    {
        path: `/tasks/${TaskId}`;
        pathObject: {readonly type: "Task"; readonly id: TaskId};
    },
    {
        path: `/tasks/${TaskId}/messages`;
        pathObject: {readonly type: "TaskComments"; readonly id: TaskId};
    },
    {
        path: `/tasks/${TaskId}/messages/${number}`;
        pathObject: {readonly type: "TaskComment"; readonly id: TaskId; readonly index: number};
    },
    {
        path: `/task-collections/${TaskCollectionId}`;
        pathObject: {readonly type: "TaskCollection"; readonly id: TaskCollectionId};
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

            return {type: "Account", id: pathSegments[1]};
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

            return {type: "Channel", id: pathSegments[1]};
        }
        case "chats": {
            if (!isId<ChatId>(pathSegments[1]!)) {
                throw new InvalidArgumentError("Second path segment isn’t an `Id`", {
                    displayMessage: getDisplayMessage(),
                });
            }

            if (pathSegments[2] === "messages") {
                if (pathSegments.length === 3) {
                    return {type: "ChatMessages", id: pathSegments[1]};
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
                return {type: "ChatMessage", id: pathSegments[1], index: messageIndex};
            } else if (pathSegments.length > 2) {
                throw new InvalidArgumentError("Expected two path segments", {
                    displayMessage: getDisplayMessage(),
                });
            }

            return {type: "Chat", id: pathSegments[1]};
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
                            id: pathSegments[1],
                            threadId: pathSegments[3],
                            index: commentIndex,
                        };
                    }

                    if (pathSegments.length !== 5) {
                        throw new InvalidArgumentError("Expected five path segments", {
                            displayMessage: getDisplayMessage(),
                        });
                    }

                    return {
                        type: "DocumentCommentThreadComments",
                        id: pathSegments[1],
                        threadId: pathSegments[3],
                    };
                }

                if (pathSegments.length !== 4) {
                    throw new InvalidArgumentError("Expected four path segments", {
                        displayMessage: getDisplayMessage(),
                    });
                }

                return {
                    type: "DocumentCommentThread",
                    id: pathSegments[1],
                    threadId: pathSegments[3],
                };
            } else {
                if (pathSegments.length !== 2) {
                    throw new InvalidArgumentError("Expected two path segments", {
                        displayMessage: getDisplayMessage(),
                    });
                }

                return {type: "Document", id: pathSegments[1]};
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

                    return {type: "PostComment", id: pathSegments[1], index: commentIndex};
                }

                if (pathSegments.length !== 3) {
                    throw new InvalidArgumentError("Expected three path segments", {
                        displayMessage: getDisplayMessage(),
                    });
                }

                return {type: "PostComments", id: pathSegments[1]};
            }

            if (pathSegments.length !== 2) {
                throw new InvalidArgumentError("Expected two path segments", {
                    displayMessage: getDisplayMessage(),
                });
            }

            return {type: "Post", id: pathSegments[1]};
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

                    return {type: "TaskComment", id: pathSegments[1], index: commentIndex};
                }

                if (pathSegments.length !== 3) {
                    throw new InvalidArgumentError("Expected three path segments", {
                        displayMessage: getDisplayMessage(),
                    });
                }

                return {type: "TaskComments", id: pathSegments[1]};
            }

            if (pathSegments.length !== 2) {
                throw new InvalidArgumentError("Expected two path segments", {
                    displayMessage: getDisplayMessage(),
                });
            }

            return {type: "Task", id: pathSegments[1]};
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

            return {type: "TaskCollection", id: pathSegments[1]};
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

/**
 * Prints a mention path to the API response format for mention targets
 * `ApiMentionTargetResponse`. `ApiMentionTargetResponse` has _both_ a string
 * `path` and properties parsed from the path like `type`, `id`, `index` etc.
 * for convenience. A developer can either use the standard path interface or
 * the parsed object format.
 */
export function printApiMentionTargetResponse(
    path: ApiMentionPath | ApiMentionPathObject,
): ApiMentionTargetResponse {
    const pathObject = typeof path === "string" ? parseApiMentionPath(path) : path;
    path = typeof path !== "string" ? printApiMentionPath(pathObject) : path;
    return {path, ...pathObject} as ApiMentionTargetResponse;
}

export function printApiPath(path: ApiPathObject): ApiPath {
    switch (path.type) {
        case "Account":
            return `/accounts/${path.id}`;
        case "Channel":
            return `/channels/${path.id}`;
        case "Chat":
            return `/chats/${path.id}`;
        case "ChatMessage":
            return `/chats/${path.id}/messages/${path.index}`;
        case "ChatMessages":
            return `/chats/${path.id}/messages`;
        case "Document":
            return `/documents/${path.id}`;
        case "DocumentCommentThread":
            return `/documents/${path.id}/threads/${path.threadId}`;
        case "DocumentComment":
            return `/documents/${path.id}/threads/${path.threadId}/messages/${path.index}`;
        case "DocumentCommentThreadComments":
            return `/documents/${path.id}/threads/${path.threadId}/messages`;
        case "Post":
            return `/posts/${path.id}`;
        case "PostComment":
            return `/posts/${path.id}/messages/${path.index}`;
        case "PostComments":
            return `/posts/${path.id}/messages`;
        case "Task":
            return `/tasks/${path.id}`;
        case "TaskComment":
            return `/tasks/${path.id}/messages/${path.index}`;
        case "TaskComments":
            return `/tasks/${path.id}/messages`;
        case "TaskCollection":
            return `/task-collections/${path.id}`;
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

export function parseApiBotWebhookEventIntoMessageRoomPathObject(
    event: ApiBotWebhookEvent,
): ApiMessageRoomPathObject {
    switch (event.type) {
        case "NewMessage": {
            return parseApiMessageRoomPath(event.roomPath);
        }
        case "NewPost": {
            return {type: "Post", id: event.postId};
        }
        default: {
            throw exhaustive(event);
        }
    }
}

export function parseApiBotWebhookEventIntoMessageRoomPath(
    event: ApiBotWebhookEvent,
): ApiMessageRoomPath {
    switch (event.type) {
        case "NewMessage": {
            return event.roomPath;
        }
        case "NewPost": {
            return `/posts/${event.postId}`;
        }
        default: {
            throw exhaustive(event);
        }
    }
}

export function parseApiMessageRoomPath(path: ApiMessageRoomPath): ApiMessageRoomPathObject {
    return parseApiPath(path) as ApiMessageRoomPathObject;
}

export function parseApiMentionPath(path: ApiMentionPath): ApiMentionPathObject {
    return parseApiPath(path) as ApiMentionPathObject;
}

export function parseApiMentionTarget(target: ApiMentionTarget): ApiMentionPathObject {
    if (hasOwnProperty(target, "type")) return target;
    return parseApiPath(target.path) as ApiMentionPathObject;
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
            return `/documents/${pathObject.id}`;
        }
        case "PostComment":
        case "PostComments": {
            return `/posts/${pathObject.id}`;
        }
        case "TaskComment":
        case "TaskComments": {
            return `/tasks/${pathObject.id}`;
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
