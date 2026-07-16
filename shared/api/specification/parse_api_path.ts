// TODO(calebmer, #api-path-destruction): We don't use this "API path" concept for
// anything important anymore. What is now an `ApiReference` object used to be an
// `ApiPath` string. `ApiPath` still exists here and there in our code but we
// should work towards totally phasing it out and replacing it with `ApiReference`
// or `ApiReferenceKey` objects.
//
// DO NOT USE THIS FOR NEW CODE.

import {
    ApiBotWebhookEvent,
    ApiMentionReference,
    ApiMessageRoomReference,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {getObjectKeysWithKeyofType} from "~/shared/helpers/object/get_object_keys_with_keyof_type.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {isId} from "~/shared/id/id.js";
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

/**
 * Any API path supported by our system.
 */
export type ApiPath = ApiPathsType[number]["path"];

/**
 * A parsed object representation of an API path in our system.
 */
export type ApiPathObject = ApiPathsType[number]["pathObject"];

export type ApiMessageRoomPath = ApiContentFilteredPathType<ApiMessageRoomReference>;

export type ApiMessageRoomMessagesListPath = `${ApiMessageRoomPath}/messages`;

export type ApiMentionReferencePath = ApiContentFilteredPathType<ApiMentionReference>;

type ApiNotMentionReferencePath = Exclude<ApiPath, ApiMentionReferencePath>;

// All `ApiPath`s excluding mentionable paths (`ApiMentionPathObject`).
export type ApiNotMentionPathObject = ApiContentFilteredPathObjectType<ApiNotMentionReferencePath>;

export type ApiContentFilteredPathObjectType<Path extends ApiPath> =
    ApiContentFilteredPathObjectTypeInner<Path, ApiPathsType>;

type ApiContentFilteredPathObjectTypeInner<
    Path extends ApiPath,
    Paths extends Array<{path: string; pathObject: object}>,
> = {
    [Key in keyof Paths]: Paths[Key]["path"] extends Path ? Paths[Key]["pathObject"] : never;
}[number];

export type ApiContentFilteredPathType<PathObject extends ApiPathObject> =
    ApiContentFilteredPathTypeInnter<PathObject, ApiPathsType>;

type ApiContentFilteredPathTypeInnter<
    PathObject extends ApiPathObject,
    Paths extends Array<{path: string; pathObject: object}>,
> = {
    [Key in keyof Paths]: Paths[Key]["pathObject"] extends PathObject ? Paths[Key]["path"] : never;
}[number];

const ApiMentionReferenceTypes = new Set<string>(
    getObjectKeysWithKeyofType(
        cast<Record<ApiMentionReference["type"], true>>({
            Account: true,
            Channel: true,
            Chat: true,
            Document: true,
            Post: true,
            Task: true,
            TaskCollection: true,
            Site: true,
        }),
    ),
);

const apiMessageRoomTypes = new Set<string>(
    getObjectKeysWithKeyofType(
        cast<Record<ApiMessageRoomReference["type"], true>>({
            Chat: true,
            Post: true,
            DocumentThread: true,
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
            readonly type: "DocumentThread";
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
        // TODO(#site-api): Implement site API.
        path: `/sites/${SiteId}`;
        pathObject: {readonly type: "Site"; readonly id: SiteId};
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
        throw new InvalidArgumentError("Path doesn\u2019t start with `/`", {
            displayMessage: getDisplayMessage(),
        });
    }

    const pathSegments = path.slice(1).split("/");

    if (pathSegments.length < 2) {
        throw new InvalidArgumentError("Path doesn\u2019t have at least two path segments", {
            displayMessage: getDisplayMessage(),
        });
    }

    switch (pathSegments[0]) {
        case "accounts": {
            if (!isId<AccountId>(pathSegments[1]!)) {
                throw new InvalidArgumentError("Second path segment isn\u2019t an `Id`", {
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
                throw new InvalidArgumentError("Second path segment isn\u2019t an `Id`", {
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
                throw new InvalidArgumentError("Second path segment isn\u2019t an `Id`", {
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
                        "Fourth path segment isn\u2019t a valid message index",
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
                throw new InvalidArgumentError("Second path segment isn\u2019t an `Id`", {
                    displayMessage: getDisplayMessage(),
                });
            }

            if (pathSegments[2] === "threads") {
                if (!isId<DocumentCommentThreadId>(pathSegments[3]!)) {
                    throw new InvalidArgumentError("Fourth path segment isn\u2019t an `Id`", {
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
                                "Sixth path segment isn\u2019t a valid message index",
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
                    type: "DocumentThread",
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
                throw new InvalidArgumentError("Second path segment isn\u2019t an `Id`", {
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
                            "Fourth path segment isn\u2019t a valid message index",
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
                throw new InvalidArgumentError("Second path segment isn\u2019t an `Id`", {
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
                            "Fourth path segment isn\u2019t a valid message index",
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
                throw new InvalidArgumentError("Second path segment isn\u2019t an `Id`", {
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
        return errorDisplayMessage`Invalid mention reference path: ${quote(path)}.`;
    }
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
        case "DocumentThread":
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
        case "Site":
            // TODO(#site-api): Implement site API.
            return `/sites/${path.id}`;
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
    return isApiMessageRoom(pathObject);
}

export function isApiMessageRoom(pathObject: ApiPathObject): pathObject is ApiMessageRoomReference {
    return apiMessageRoomTypes.has(pathObject.type);
}

export function parseApiBotWebhookEventIntoMessageRoom(
    event: ApiBotWebhookEvent,
): ApiMessageRoomReference {
    switch (event.type) {
        case "UpdatedMessageStreamExperimentalApprovalsPart":
        case "CreatedMessage": {
            return event.room;
        }
        case "CreatedPost": {
            return {type: "Post", id: event.post.id};
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
        case "UpdatedMessageStreamExperimentalApprovalsPart":
        case "CreatedMessage": {
            return printApiMessageRoomPath(event.room);
        }
        case "CreatedPost": {
            return `/posts/${event.post.id}`;
        }
        default: {
            throw exhaustive(event);
        }
    }
}

export function printApiMessageRoomPath(path: ApiMessageRoomReference): ApiMessageRoomPath {
    return printApiPath(path) as ApiMessageRoomPath;
}

export function parseApiMessageRoomPath(path: ApiMessageRoomPath): ApiMessageRoomReference {
    return parseApiPath(path) as ApiMessageRoomReference;
}

export function printApiMentionReference(path: ApiMentionReference): ApiMentionReferencePath {
    return printApiPath(path) as ApiMentionReferencePath;
}

export function parseApiMentionReference(path: ApiMentionReferencePath): ApiMentionReference {
    return parseApiPath(path) as ApiMentionReference;
}

export function parseApiNotMentionReference(
    path: ApiNotMentionReferencePath,
): ApiNotMentionPathObject {
    return parseApiPath(path) as ApiNotMentionPathObject;
}

export function isApiMentionReferencePath(path: ApiPath): path is ApiMentionReferencePath {
    const pathObject = parseApiPath(path);
    return ApiMentionReferenceTypes.has(pathObject.type);
}

export function isApiNotMentionReferencePath(path: ApiPath): path is ApiNotMentionReferencePath {
    return !isApiMentionReferencePath(path);
}

export function getApiMentionReferencePathIfExists(path: ApiPath): ApiMentionReferencePath | null {
    if (isApiMentionReferencePath(path)) return path;

    const pathObject = parseApiNotMentionReference(path);

    switch (pathObject.type) {
        case "DocumentThread":
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
        case "ChatMessage":
        case "ChatMessages": {
            return null;
        }
        default: {
            throw exhaustive(pathObject);
        }
    }
}
