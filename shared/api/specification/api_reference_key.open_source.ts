import type {ApiReference} from "~/shared/api/specification/types/api_reference.open_source.js";
import {InvalidArgumentError} from "~/shared/error/error.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {convertPascalCaseToKebabCase} from "~/shared/helpers/string/convert_pascal_case_to_kebab_case.open_source.js";
import {assertId} from "~/shared/id/id.open_source.js";
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
} from "~/shared/id/types/id_types.open_source.js";

export type ApiReferenceKey =
    | `Account:${AccountId}`
    | `Channel:${ChannelId}`
    | `Chat:${ChatId}`
    | `ChatMessage:${ChatId}-${number}`
    | `Document:${DocumentId}`
    | `DocumentMessage:${DocumentId}-${DocumentCommentThreadId}-${number}`
    | `DocumentThread:${DocumentId}-${DocumentCommentThreadId}`
    | `Post:${PostId}`
    | `PostMessage:${PostId}-${number}`
    | `Task:${TaskId}`
    | `TaskMessage:${TaskId}-${number}`
    | `TaskCollection:${TaskCollectionId}`
    | `Site:${SiteId}`;

// Make sure the type before the `:` in `ApiReferenceKey` exactly matches reference
// `type` properties. That way we can conveniently filter `ApiReferenceKey` by
// type.
assertEqualTypes<
    ApiReferenceKey extends `${infer Type}:${string}` ? Type : never,
    ApiReference["type"]
>();

export function printApiReferenceKey(key: ApiReference): ApiReferenceKey {
    switch (key.type) {
        case "Account":
            return `Account:${key.id}`;
        case "Channel":
            return `Channel:${key.id}`;
        case "Chat":
            return `Chat:${key.id}`;
        case "ChatMessage":
            return `ChatMessage:${key.id}-${key.index}`;
        case "Document":
            return `Document:${key.id}`;
        case "DocumentMessage":
            return `DocumentMessage:${key.document.id}-${key.id}-${key.index}`;
        case "DocumentThread":
            return `DocumentThread:${key.document.id}-${key.id}`;
        case "Post":
            return `Post:${key.id}`;
        case "PostMessage":
            return `PostMessage:${key.id}-${key.index}`;
        case "Task":
            return `Task:${key.id}`;
        case "TaskMessage":
            return `TaskMessage:${key.id}-${key.index}`;
        case "TaskCollection":
            return `TaskCollection:${key.id}`;
        case "Site":
            return `Site:${key.id}`;
        default:
            throw exhaustive(key);
    }
}

export function parseApiReferenceKey(key: ApiReferenceKey): ApiReference {
    const [type = "", data = ""] = key.split(":", 2);

    switch (type) {
        case "Account":
            return {type: "Account", id: assertId<AccountId>(data)};

        case "Channel":
            return {type: "Channel", id: assertId<ChannelId>(data)};

        case "Chat":
            return {type: "Chat", id: assertId<ChatId>(data)};

        case "ChatMessage": {
            const [data1 = "", data2 = ""] = data.split("-", 2);
            return {
                type: "ChatMessage",
                id: assertId<ChatId>(data1),
                index: parseInt(data2, 10),
            };
        }

        case "Document":
            return {type: "Document", id: assertId<DocumentId>(data)};

        case "DocumentMessage": {
            const [data1 = "", data2 = "", data3 = ""] = data.split("-", 3);

            return {
                type: "DocumentMessage",
                document: {id: assertId<DocumentId>(data1)},
                id: assertId<DocumentCommentThreadId>(data2),
                index: parseInt(data3, 10),
            };
        }

        case "DocumentThread": {
            const [data1 = "", data2 = ""] = data.split("-", 2);

            return {
                type: "DocumentThread",
                document: {id: assertId<DocumentId>(data1)},
                id: assertId<DocumentCommentThreadId>(data2),
            };
        }

        case "Post":
            return {type: "Post", id: assertId<PostId>(data)};

        case "PostMessage": {
            const [data1 = "", data2 = ""] = data.split("-", 2);
            return {
                type: "PostMessage",
                id: assertId<PostId>(data1),
                index: parseInt(data2, 10),
            };
        }

        case "Task":
            return {type: "Task", id: assertId<TaskId>(data)};

        case "TaskMessage": {
            const [data1 = "", data2 = ""] = data.split("-", 2);
            return {
                type: "TaskMessage",
                id: assertId<TaskId>(data1),
                index: parseInt(data2, 10),
            };
        }

        case "TaskCollection":
            return {type: "TaskCollection", id: assertId<TaskCollectionId>(data)};

        case "Site":
            return {type: "Site", id: assertId<SiteId>(data)};

        default:
            throw new InvalidArgumentError("Unrecognized `ApiReferenceKey` type");
    }
}

export function convertApiReferenceKeyToLowercase(key: ApiReferenceKey): string {
    const [type = "", data = ""] = key.split(":", 2);

    // All data must be lower case for now. If ever we have keys where some data needs
    // to be upper case, we'll need to add a special case here.
    assert(data === data.toLowerCase());

    return `${convertPascalCaseToKebabCase(type)}:${data}`;
}
