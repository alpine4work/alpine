import {InternalError, UnimplementedError} from "~/shared/error/error.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {UnionToIntersection} from "~/shared/helpers/types/union_to_intersection.js";
import {isId} from "~/shared/id/id.js";
import {
    ChannelId,
    ChatId,
    DocumentId,
    FileId,
    PostId,
    SiteId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * Search entities you can create file nodes in content for. This embeds a preview
 * of the entity inline which looks nice within prose.
 */
export type FileEntityId =
    | `Document:${DocumentId}`
    | `Task:${TaskId}`
    | `TaskCollection:${TaskCollectionId}`
    | `Channel:${ChannelId}`
    | `Chat:${ChatId}`
    | `Post:${PostId}`
    | `Site:${SiteId}`;

export const FileEntityIdSchema = Schema.string as Schema<FileEntityId>;

export const FileIdOrFileEntityIdSchema = Schema.string.validation(
    "Is `FileId` or `FileEntityId`",
    (value): value is FileId | FileEntityId => isId<FileId>(value) || isFileEntityId(value),
);

/**
 * The types of a `FileEntityId`.
 */
export type FileEntityType = keyof typeof fileEntityIdTestMap;

/**
 * Parsed representation of a `FileEntityId` string for easier manipulation.
 * Convert `FileEntityId` to this object with `parseFileEntityId()`.
 */
export type FileEntityIdObject =
    | {readonly type: "Document"; readonly documentId: DocumentId}
    | {readonly type: "Task"; readonly taskId: TaskId}
    | {readonly type: "TaskCollection"; readonly collectionId: TaskCollectionId}
    | {readonly type: "Channel"; readonly channelId: ChannelId}
    | {readonly type: "Chat"; readonly chatId: ChatId}
    | {readonly type: "Post"; readonly postId: PostId}
    | {readonly type: "Site"; readonly siteId: SiteId};

/**
 * Parse a `FileEntityId` into a more convenient to use object format.
 */
export function parseFileEntityId(id: FileEntityId): FileEntityIdObject {
    const [idType, idPayload] = id.split(":");
    const idPayloadParts = idPayload?.split("-") ?? [];

    switch (idType) {
        case "Document":
            return {type: "Document", documentId: idPayloadParts[0] as DocumentId};
        case "Task":
            return {type: "Task", taskId: idPayloadParts[0] as TaskId};
        case "TaskCollection":
            return {type: "TaskCollection", collectionId: idPayloadParts[0] as TaskCollectionId};
        case "Channel":
            return {type: "Channel", channelId: idPayloadParts[0] as ChannelId};
        case "Chat":
            return {type: "Chat", chatId: idPayloadParts[0] as ChatId};
        case "Post":
            return {type: "Post", postId: idPayloadParts[0] as PostId};
        default:
            throw new InternalError(quote`Unrecognized \`FileEntityId\` type ${idType ?? ""}`);
    }
}

type GetFileEntityIdTestMapUnionType<Id extends string> = Id extends `${infer IdType}:${string}`
    ? Record<IdType, (idRest: string) => boolean>
    : Record<Id, null>;

type GetFileEntityIdTestMapType<Id extends string> = MergeObjectIntersection<
    UnionToIntersection<GetFileEntityIdTestMapUnionType<Id>>
>;

const fileEntityIdTestMap: GetFileEntityIdTestMapType<FileEntityId> = {
    Document: isId,
    Task: isId,
    TaskCollection: isId,
    Channel: isId,
    Chat: isId,
    Post: isId,
    Site: isId,
};

assertEqualTypes<keyof typeof fileEntityIdTestMap, FileEntityIdObject["type"]>();

let fileEntityTypes: ReadonlyArray<keyof typeof fileEntityIdTestMap> | null = null;

/**
 * The entity types which make for valid `SearchMentionEntityId`s.
 */
export function getFileEntityTypes() {
    fileEntityTypes ??= Object.keys(fileEntityIdTestMap) as ReadonlyArray<
        keyof typeof fileEntityIdTestMap
    >;
    return fileEntityTypes;
}

/**
 * Is the provided string a valid `FileEntityId`?
 */
export function isFileEntityId(id: string): id is FileEntityId {
    const [idType = "", idRest = ""] = id.split(":", 2);
    const idTest = cast<{[key: string]: ((idRest: string) => boolean) | null}>(fileEntityIdTestMap)[
        idType
    ];

    if (idTest === undefined) return false;

    if (idTest === null) {
        // Implies that `idRest` is an empty string.
        return id === idType;
    }

    return idTest(idRest);
}

/**
 * Get the path corresponding to the provided `FileEntityId`.
 */
export function printFileEntityIdIntoPath(spaceId: SpaceId, id: FileEntityId): string {
    const idObject = parseFileEntityId(id);

    switch (idObject.type) {
        case "Document":
            return `/s/${spaceId}/documents/${idObject.documentId}`;
        case "Task":
            return `/s/${spaceId}/tasks/${idObject.taskId}`;
        case "TaskCollection":
            return `/s/${spaceId}/tasks/collections/${idObject.collectionId}`;
        case "Channel":
            return `/s/${spaceId}/channels/${idObject.channelId}`;
        case "Chat":
            return `/s/${spaceId}/chat/${idObject.chatId}`;
        case "Post":
            return `/s/${spaceId}/posts/${idObject.postId}`;
        case "Site":
            // TODO(#sites): Implement site file entity id path.
            throw new UnimplementedError("Site file entities aren\u2019t implemented");
        default:
            throw exhaustive(idObject);
    }
}
