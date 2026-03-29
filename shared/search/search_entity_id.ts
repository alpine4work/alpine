import {InternalError} from "~/shared/error/error.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {hasOwnProperty} from "~/shared/helpers/object/has_own_property.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {UnionToIntersection} from "~/shared/helpers/types/union_to_intersection.js";
import {isId} from "~/shared/id/id.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    SiteId,
    SpaceId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema.js";

/**
 * The identifier of an entity in our search system. Search entities are a
 * consistent format we convert all content in our system to for presentation in
 * search.
 */
export type SearchEntityId = {
    [Key in keyof SearchEntityIdAxes]: SearchEntityIdAxes[Key][keyof SearchEntityIdAxes[Key]];
}[keyof SearchEntityIdAxes];

export const SearchEntityIdSchema = Schema.string.transform<SearchEntityId>({
    serialize: id => id,
    deserialize: id => {
        if (!isSearchEntityId(id))
            throw new SchemaDeserializationError("Expected search entity id");

        return id;
    },
});

type SearchEntityIdAxes = {
    Dynamic: {
        Affinity:
            | `Account:${AccountId}`
            | `Document:${DocumentId}`
            | `Channel:${ChannelId}`
            | `Chat:${ChatId}`
            | `Task:${TaskId}`
            | `TaskCollection:${TaskCollectionId}`
            | `Site:${SiteId}`;
        NotAffinity:
            | `DocumentComment:${DocumentId}-${DocumentCommentThreadId}-${number}`
            | `Post:${PostId}`
            | `PostComment:${PostId}-${number}`
            | `ChatMessage:${ChatId}-${number}`
            | `TaskComment:${TaskId}-${number}`;
    };
    Static: {
        Affinity: "TaskPersonal";
        NotAffinity:
            | "CreateChatMessage"
            | "CreatePost"
            | "CreateChannel"
            | "CreateDocument"
            | "CreateTask"
            | "CreateTaskCollection"
            | "CreateTaskView"
            | "TaskQueryFilteredToCreatorIsCurrentAccount"
            | "TaskQueryFilteredToAssigneeIsCurrentAccount"
            | "TaskQueryFilteredToAssigneeIsCurrentAccountAndAssigneeStatusIsActive"
            | "TaskQueryFilteredToAssignerIsCurrentAccount"
            | "SearchFavorites";
    };
};

type SearchEntityByDynamicOrStaticAxis = {
    [Key in keyof SearchEntityIdAxes]: SearchEntityIdAxes[Key][keyof SearchEntityIdAxes[Key]];
};

type SearchEntityByAffinityOrNotAffinityAxis = {
    [Key in keyof SearchEntityIdAxes]: SearchEntityIdAxes[Key];
}[keyof SearchEntityIdAxes];

/**
 * Search entities that are indexed in OpenSearch. Not all entities are indexed in
 * OpenSearch. Some entities are statically known and have no variations from space
 * to space. For example the "My tasks" view. We always know the title of this
 * entity is "My tasks".
 */
export type SearchDynamicEntityId = SearchEntityByDynamicOrStaticAxis["Dynamic"];

export const SearchDynamicEntityIdSchema = SearchEntityIdSchema.transform<SearchDynamicEntityId>({
    serialize: id => id,
    deserialize: id => {
        if (!isSearchDynamicEntityId(id))
            throw new SchemaDeserializationError("Expected search dynamic entity id");

        return id;
    },
});

/**
 * Search entities that are not indexed in OpenSearch. These entities are static
 * and never change. We can search across these entities entirely on the client.
 */
export type SearchStaticEntityId = SearchEntityByDynamicOrStaticAxis["Static"];

export const SearchStaticEntityIdSchema = SearchEntityIdSchema.transform<SearchStaticEntityId>({
    serialize: id => id,
    deserialize: id => {
        if (!isSearchStaticEntityId(id))
            throw new SchemaDeserializationError("Expected search static entity id");

        return id;
    },
});

export type GetSearchEntityIdActualTestMapUnionType<Id extends string> =
    Id extends `${infer IdType}:${string}`
        ? Record<IdType, (idRest: string) => boolean>
        : Record<Id, null>;

type GetSearchEntityIdActualTestMapType<Id extends string> = MergeObjectIntersection<
    UnionToIntersection<GetSearchEntityIdActualTestMapUnionType<Id>>
>;

const searchEntityIdTestMap: GetSearchEntityIdActualTestMapType<SearchEntityId> = {
    Account: isId,
    Document: isId,
    Channel: isId,
    Chat: isId,
    Task: isId,
    TaskCollection: isId,
    DocumentComment: isIdAndIdAndMessageIndex,
    Post: isId,
    Site: isId,
    PostComment: isIdAndMessageIndex,
    ChatMessage: isIdAndMessageIndex,
    TaskComment: isIdAndMessageIndex,
    TaskPersonal: null,
    CreateChatMessage: null,
    CreatePost: null,
    CreateChannel: null,
    CreateDocument: null,
    CreateTask: null,
    CreateTaskCollection: null,
    CreateTaskView: null,
    TaskQueryFilteredToCreatorIsCurrentAccount: null,
    TaskQueryFilteredToAssigneeIsCurrentAccount: null,
    TaskQueryFilteredToAssigneeIsCurrentAccountAndAssigneeStatusIsActive: null,
    TaskQueryFilteredToAssignerIsCurrentAccount: null,
    SearchFavorites: null,
};

export type SearchEntityType = keyof typeof searchEntityIdTestMap;

function isIdAndMessageIndex(string: string): boolean {
    const [idString = "", messageIndexString = ""] = string.split("-", 2);
    if (!isId(idString)) return false;
    return /\d+/.test(messageIndexString);
}

function isIdAndIdAndMessageIndex(string: string): boolean {
    const [id1String = "", id2String = "", messageIndexString = ""] = string.split("-", 3);
    if (!isId(id1String)) return false;
    if (!isId(id2String)) return false;
    return /\d+/.test(messageIndexString);
}

type GetSearchEntityIdTestMapUnionType<Id extends string> = Id extends `${infer IdType}:${string}`
    ? Record<IdType, true>
    : Record<Id, true>;

type GetSearchEntityIdTestMapType<Id extends string> = MergeObjectIntersection<
    UnionToIntersection<GetSearchEntityIdTestMapUnionType<Id>>
>;

const searchDynamicEntityIdTestMap: GetSearchEntityIdTestMapType<SearchDynamicEntityId> = {
    Account: true,
    Document: true,
    DocumentComment: true,
    Channel: true,
    Chat: true,
    ChatMessage: true,
    Task: true,
    TaskCollection: true,
    TaskComment: true,
    Post: true,
    PostComment: true,
    Site: true,
};

export type SearchDynamicEntityType = keyof typeof searchDynamicEntityIdTestMap;

export function isSearchDynamicEntityType(string: string): string is SearchDynamicEntityType {
    return hasOwnProperty(searchDynamicEntityIdTestMap, string);
}

const searchStaticEntityIdTestMap: GetSearchEntityIdTestMapType<SearchStaticEntityId> = {
    TaskPersonal: true,
    CreateChatMessage: true,
    CreatePost: true,
    CreateChannel: true,
    CreateDocument: true,
    CreateTask: true,
    CreateTaskCollection: true,
    CreateTaskView: true,
    TaskQueryFilteredToCreatorIsCurrentAccount: true,
    TaskQueryFilteredToAssigneeIsCurrentAccount: true,
    TaskQueryFilteredToAssigneeIsCurrentAccountAndAssigneeStatusIsActive: true,
    TaskQueryFilteredToAssignerIsCurrentAccount: true,
    SearchFavorites: true,
};

/**
 * Is the provided string a valid `SearchEntityId`?
 */
export function isSearchEntityId(id: string): id is SearchEntityId {
    const [idType = "", idRest = ""] = id.split(":", 2);
    const idTest = cast<{[key: string]: ((idRest: string) => boolean) | null}>(
        searchEntityIdTestMap,
    )[idType];

    if (idTest === undefined) return false;

    if (idTest === null) {
        // Implies that `idRest` is an empty string.
        return id === idType;
    }

    return idTest(idRest);
}

/**
 * Is the provided `SearchEntityId` a valid `SearchDynamicEntityId`?
 */
export function isSearchDynamicEntityId(id: SearchEntityId): id is SearchDynamicEntityId {
    const [idType = ""] = id.split(":", 2);
    return cast<{[key: string]: true}>(searchDynamicEntityIdTestMap)[idType] === true;
}

export function isSearchDynamicEntityIdWithoutAccount(
    id: SearchEntityId,
): id is Exclude<SearchDynamicEntityId, `Account:${AccountId}`> {
    const [idType = ""] = id.split(":", 2);
    if (idType === "Account") return false;

    return cast<{[key: string]: true}>(searchDynamicEntityIdTestMap)[idType] === true;
}

/**
 * Is the provided `SearchEntityId` a `SearchStaticEntityId`?
 */
export function isSearchStaticEntityId(id: SearchEntityId): id is SearchStaticEntityId {
    const [idType = ""] = id.split(":", 2);
    return cast<{[key: string]: true}>(searchStaticEntityIdTestMap)[idType] === true;
}

/**
 * Search entities that we record affinity points for. Not every search entity has
 * affinity points. Notably comments and chat messages don't get affinity points.
 * Entities with a long lifespan that the user will likely want to find again get
 * affinity points.
 *
 * Search affinity entities are also the only entities which can be favorited. The
 * search affinity list is entirely comprised of search affinity entities.
 *
 * Posts are not given affinity points. Posts are designed to be short lived and
 * probably don't have a lifespan beyond a couple days. Even if a post receives
 * heated conversation. Posts live and die by the inbox. If a post receives new
 * comments, you'll be reminded of it. Otherwise it's ok for posts to fade into
 * obscurity.
 */
export type SearchAffinityEntityId = SearchEntityByAffinityOrNotAffinityAxis["Affinity"];

export const SearchAffinityEntityIdSchema = SearchEntityIdSchema.transform<SearchAffinityEntityId>({
    serialize: id => id,
    deserialize: id => {
        if (!isSearchAffinityEntityId(id))
            throw new SchemaDeserializationError("Expected search affinity entity id");

        return id;
    },
});

type SearchEntityIdType<Id extends string> = Id extends `${infer Type}:${string}` ? Type : Id;

// Make sure there's no overlap between the base `SearchEntityId` axes.
assertEqualTypes<
    SearchEntityIdType<SearchEntityIdAxes["Dynamic"]["Affinity"]> &
        SearchEntityIdType<SearchEntityIdAxes["Dynamic"]["NotAffinity"]>,
    never
>();
assertEqualTypes<
    SearchEntityIdType<SearchEntityIdAxes["Dynamic"]["Affinity"]> &
        SearchEntityIdType<SearchEntityIdAxes["Static"]["Affinity"]>,
    never
>();
assertEqualTypes<
    SearchEntityIdType<SearchEntityIdAxes["Dynamic"]["Affinity"]> &
        SearchEntityIdType<SearchEntityIdAxes["Static"]["NotAffinity"]>,
    never
>();
assertEqualTypes<
    SearchEntityIdType<SearchEntityIdAxes["Dynamic"]["NotAffinity"]> &
        SearchEntityIdType<SearchEntityIdAxes["Static"]["Affinity"]>,
    never
>();
assertEqualTypes<
    SearchEntityIdType<SearchEntityIdAxes["Dynamic"]["NotAffinity"]> &
        SearchEntityIdType<SearchEntityIdAxes["Static"]["NotAffinity"]>,
    never
>();
assertEqualTypes<
    SearchEntityIdType<SearchEntityIdAxes["Static"]["Affinity"]> &
        SearchEntityIdType<SearchEntityIdAxes["Static"]["NotAffinity"]>,
    never
>();

/**
 * Search entities which can be @ mentioned. Basically entities with a title since
 * that's all that's rendered in the mention.
 */
export type SearchMentionEntityId =
    | `Document:${DocumentId}`
    | `Channel:${ChannelId}`
    | `Chat:${ChatId}`
    | `Task:${TaskId}`
    | `TaskCollection:${TaskCollectionId}`
    | `Post:${PostId}`
    | `Site:${SiteId}`;

export const SearchMentionEntityIdSchema = SearchEntityIdSchema.transform<SearchMentionEntityId>({
    serialize: id => id,
    deserialize: id => {
        if (!isSearchMentionEntityId(id))
            throw new SchemaDeserializationError("Expected search mention entity id");

        return id;
    },
});

assertAssignableTypes<SearchMentionEntityId, SearchEntityId>();
assertEqualTypes<
    SearchMentionEntityId,
    Exclude<SearchAffinityEntityId, `Account:${AccountId}` | "TaskPersonal"> | `Post:${PostId}`
>();

/**
 * Parsed representation of a `SearchDynamicEntityId` string for easier
 * manipulation. Convert `SearchDynamicEntityId` to this object with
 * `parseSearchDynamicEntityId()`.
 */
export type SearchDynamicEntityIdObject =
    | {readonly type: "Account"; readonly accountId: AccountId}
    | {readonly type: "Document"; readonly documentId: DocumentId}
    | {
          readonly type: "DocumentComment";
          readonly documentId: DocumentId;
          readonly commentThreadId: DocumentCommentThreadId;
          readonly commentIndex: number;
      }
    | {readonly type: "Channel"; readonly channelId: ChannelId}
    | {readonly type: "Post"; readonly postId: PostId}
    | {readonly type: "PostComment"; readonly postId: PostId; readonly commentIndex: number}
    | {readonly type: "Chat"; readonly chatId: ChatId}
    | {readonly type: "ChatMessage"; readonly chatId: ChatId; readonly messageIndex: number}
    | {readonly type: "Task"; readonly taskId: TaskId}
    | {readonly type: "TaskCollection"; readonly collectionId: TaskCollectionId}
    | {readonly type: "TaskComment"; readonly taskId: TaskId; readonly commentIndex: number}
    | {readonly type: "Site"; readonly siteId: SiteId};

export function parseSearchDynamicEntityIdWithoutAccount(
    id: Exclude<SearchDynamicEntityId, `Account:${AccountId}`>,
): Exclude<SearchDynamicEntityIdObject, {type: "Account"; accountId: AccountId}> {
    const entity = parseSearchDynamicEntityId(id);
    if (entity.type !== "Account") return entity;

    throw new InternalError(
        quote`Account type found in \`SearchDynamicEntityId\` but expected a non-account type`,
    );
}
/**
 * Parse a `SearchDynamicEntityId` into a more convenient to use object format.
 */
export function parseSearchDynamicEntityId(id: SearchDynamicEntityId): SearchDynamicEntityIdObject {
    const [idType, idPayload] = id.split(":");
    const idPayloadParts = idPayload?.split("-") ?? [];

    switch (idType) {
        case "Account":
            return {type: "Account", accountId: idPayloadParts[0] as AccountId};
        case "Document":
            return {type: "Document", documentId: idPayloadParts[0] as DocumentId};
        case "DocumentComment":
            return {
                type: "DocumentComment",
                documentId: idPayloadParts[0] as DocumentId,
                commentThreadId: idPayloadParts[1] as DocumentCommentThreadId,
                commentIndex: parseInt(idPayloadParts[2]!, 10),
            };
        case "Channel":
            return {type: "Channel", channelId: idPayloadParts[0] as ChannelId};
        case "Post":
            return {type: "Post", postId: idPayloadParts[0] as PostId};
        case "PostComment":
            return {
                type: "PostComment",
                postId: idPayloadParts[0] as PostId,
                commentIndex: parseInt(idPayloadParts[1]!, 10),
            };
        case "Chat":
            return {type: "Chat", chatId: idPayloadParts[0] as ChatId};
        case "ChatMessage":
            return {
                type: "ChatMessage",
                chatId: idPayloadParts[0] as ChatId,
                messageIndex: parseInt(idPayloadParts[1]!, 10),
            };
        case "Task":
            return {type: "Task", taskId: idPayloadParts[0] as TaskId};
        case "TaskCollection":
            return {type: "TaskCollection", collectionId: idPayloadParts[0] as TaskCollectionId};
        case "TaskComment":
            return {
                type: "TaskComment",
                taskId: idPayloadParts[0] as TaskId,
                commentIndex: parseInt(idPayloadParts[1]!, 10),
            };
        default:
            throw new InternalError(
                quote`Unrecognized \`SearchDynamicEntityId\` type ${idType ?? ""}`,
            );
    }
}

/**
 * Print a `SearchDynamicEntityId` from the more convenient to manipulate object
 * format.
 */
export function printSearchDynamicEntityId(
    idObject: SearchDynamicEntityIdObject,
): SearchDynamicEntityId {
    switch (idObject.type) {
        case "Account":
            return `Account:${idObject.accountId}`;
        case "Document":
            return `Document:${idObject.documentId}`;
        case "DocumentComment":
            return `DocumentComment:${idObject.documentId}-${idObject.commentThreadId}-${idObject.commentIndex}`;
        case "Channel":
            return `Channel:${idObject.channelId}`;
        case "Post":
            return `Post:${idObject.postId}`;
        case "PostComment":
            return `PostComment:${idObject.postId}-${idObject.commentIndex}`;
        case "Chat":
            return `Chat:${idObject.chatId}`;
        case "ChatMessage":
            return `ChatMessage:${idObject.chatId}-${idObject.messageIndex}`;
        case "Task":
            return `Task:${idObject.taskId}`;
        case "TaskCollection":
            return `TaskCollection:${idObject.collectionId}`;
        case "TaskComment":
            return `TaskComment:${idObject.taskId}-${idObject.commentIndex}`;
        case "Site":
            return `Site:${idObject.siteId}`;
        default:
            throw exhaustive(idObject);
    }
}

const searchAffinityEntityIdTestMap: GetSearchEntityIdTestMapType<SearchAffinityEntityId> = {
    Account: true,
    Document: true,
    Channel: true,
    Chat: true,
    Task: true,
    TaskCollection: true,
    TaskPersonal: true,
    Site: true,
};

export type SearchAffinityEntityType = keyof typeof searchAffinityEntityIdTestMap;

/**
 * Is the provided `SearchEntityId` a valid `SearchAffinityEntityId`?
 */
export function isSearchAffinityEntityId(id: SearchEntityId): id is SearchAffinityEntityId {
    const [idType = ""] = id.split(":", 2);
    return cast<{[key: string]: true}>(searchAffinityEntityIdTestMap)[idType] === true;
}

/**
 * Parse a `SearchAffinityEntityId` into a more convenient to use object format.
 */
export function parseSearchAffinityEntityId(
    id: SearchAffinityEntityId & SearchDynamicEntityId,
): SearchDynamicEntityIdObject & {readonly type: SearchAffinityEntityType} {
    return parseSearchDynamicEntityId(id) as SearchDynamicEntityIdObject & {
        readonly type: SearchAffinityEntityType;
    };
}

type GetSearchMentionEntityIdTestMapUnionType<Id extends string> =
    Id extends `${infer IdType}:${string}` ? Record<IdType, true> : Record<Id, false>;

type GetSearchMentionEntityIdTestMapType<Id extends string> = MergeObjectIntersection<
    UnionToIntersection<GetSearchMentionEntityIdTestMapUnionType<Id>>
>;

const searchMentionEntityIdTestMap: GetSearchMentionEntityIdTestMapType<SearchMentionEntityId> = {
    Document: true,
    Channel: true,
    Chat: true,
    Task: true,
    TaskCollection: true,
    Post: true,
    Site: true,
};

export type SearchMentionEntityType = keyof typeof searchMentionEntityIdTestMap;

let searchMentionEntityTypes: ReadonlyArray<SearchMentionEntityType> | null = null;

/**
 * The entity types which make for valid `SearchMentionEntityId`s.
 */
export function getSearchMentionEntityTypes() {
    searchMentionEntityTypes ??= Object.keys(
        searchMentionEntityIdTestMap,
    ) as ReadonlyArray<SearchMentionEntityType>;
    return searchMentionEntityTypes;
}

/**
 * Is the provided `SearchEntityId` a valid `SearchMentionEntityId`?
 */
export function isSearchMentionEntityId(
    id: SearchEntityId | `Account:${AccountId}~${SpaceId}`,
): id is SearchMentionEntityId {
    const [idType = ""] = id.split(":", 2);
    return cast<{[key: string]: true}>(searchMentionEntityIdTestMap)[idType] === true;
}

/**
 * Parse a `SearchMentionEntityId` into a more convenient to use object format.
 */
export function parseSearchMentionEntityId(
    id: SearchMentionEntityId,
): SearchDynamicEntityIdObject & {readonly type: SearchMentionEntityType} {
    return parseSearchDynamicEntityId(id) as SearchDynamicEntityIdObject & {
        readonly type: SearchMentionEntityType;
    };
}
