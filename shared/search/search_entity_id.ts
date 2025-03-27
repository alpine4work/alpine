import {InternalError} from "~/shared/error/error.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {UnionToIntersection} from "~/shared/helpers/types/union_to_intersection.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    ContentMentionAccountId,
    DocumentCommentThreadId,
    DocumentId,
    PostId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";

/**
 * The identifier of an entity in our search system. Search entities are a
 * consistent format we convert all content in our system to for presentation
 * in search.
 */
export type SearchEntityId = {
    [Key in keyof SearchEntityIdAxes]: SearchEntityIdAxes[Key][keyof SearchEntityIdAxes[Key]];
}[keyof SearchEntityIdAxes];

export const SearchEntityIdSchema = Schema.string as Schema<SearchEntityId>;

type SearchEntityIdAxes = {
    Dynamic: {
        Affinity:
            | `Account:${AccountId | ContentMentionAccountId}`
            | `Document:${DocumentId}`
            | `Channel:${ChannelId}`
            | `Chat:${ChatId}`
            | `Task:${TaskId}`
            | `TaskCollection:${TaskCollectionId}`;
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
            | "TaskQueryFilteredToAssignerIsCurrentAccount";
    };
};

type SearchEntityByDynamicOrStaticAxis = {
    [Key in keyof SearchEntityIdAxes]: SearchEntityIdAxes[Key][keyof SearchEntityIdAxes[Key]];
};

type SearchEntityByAffinityOrNotAffinityAxis = {
    [Key in keyof SearchEntityIdAxes]: SearchEntityIdAxes[Key];
}[keyof SearchEntityIdAxes];

/**
 * Search entities that are indexed in OpenSearch. Not all entities are indexed
 * in OpenSearch. Some entities are statically known and have no variations
 * from space to space. For example the "My tasks" view. We always know the
 * title of this entity is "My tasks".
 */
export type SearchDynamicEntityId = SearchEntityByDynamicOrStaticAxis["Dynamic"];

export const SearchDynamicEntityIdSchema = Schema.string as Schema<SearchDynamicEntityId>;

/**
 * Search entities that are not indexed in OpenSearch. These entities are
 * static and never change. We can search across these entities entirely on the
 * client.
 */
export type SearchStaticEntityId = SearchEntityByDynamicOrStaticAxis["Static"];

export const SearchStaticEntityIdSchema = Schema.string as Schema<SearchStaticEntityId>;

/**
 * Search entities that we record affinity points for. Not every search
 * entity has affinity points. Notably comments and chat messages don't get
 * affinity points. Entities with a long lifespan that the user will likely
 * want to find again get affinity points.
 *
 * Search affinity entities are also the only entities which can be favorited.
 * The search affinity list is entirely comprised of search affinity entities.
 *
 * Posts are not given affinity points. Posts are designed to be short lived
 * and probably don't have a lifespan beyond a couple days. Even if a post
 * receives heated conversation. Posts live and die by the inbox. If a post
 * receives new comments, you'll be reminded of it. Otherwise it's ok for posts
 * to fade into obscurity.
 */
export type SearchAffinityEntityId = SearchEntityByAffinityOrNotAffinityAxis["Affinity"];

export const SearchAffinityEntityIdSchema = Schema.string as Schema<SearchAffinityEntityId>;

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
 * Parsed representation of a `SearchDynamicEntityId` string for easier
 * manipulation. Convert `SearchDynamicEntityId` to this object with
 * `parseSearchDynamicEntityId()`.
 */
export type SearchDynamicEntityIdObject =
    | {readonly type: "Account"; readonly accountId: AccountId | ContentMentionAccountId}
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
    | {readonly type: "TaskComment"; readonly taskId: TaskId; readonly commentIndex: number};

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
            throw new InternalError(quote`Unrecognized search entity ID type ${idType ?? ""}`);
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
        default:
            throw exhaustive(idObject);
    }
}

type GetSearchAffinityEntityIdTestMapUnionType<Id extends string> =
    Id extends `${infer IdType}:${string}` ? Record<IdType, true> : Record<Id, false>;

type GetSearchAffinityEntityIdTestMapType<Id extends string> = MergeObjectIntersection<
    UnionToIntersection<GetSearchAffinityEntityIdTestMapUnionType<Id>>
>;

const searchAffinityEntityIdTestMap: GetSearchAffinityEntityIdTestMapType<SearchAffinityEntityId> =
    {
        Account: true,
        Document: true,
        Channel: true,
        Chat: true,
        Task: true,
        TaskCollection: true,
        TaskPersonal: false,
    };

/**
 * Is the provided `SearchEntityId` a valid `SearchAffinityEntityId`?
 */
export function isSearchAffinityEntityId(id: SearchEntityId): id is SearchAffinityEntityId {
    const [idType = "", idRest = ""] = id.split(":", 2);
    const idTest = cast<{[key: string]: boolean}>(searchAffinityEntityIdTestMap)[idType];

    if (idTest === undefined) return false;

    if (idTest) {
        return idRest.length > 0;
    } else {
        // Implies that `idRest` is an empty string.
        return id === idType;
    }
}
