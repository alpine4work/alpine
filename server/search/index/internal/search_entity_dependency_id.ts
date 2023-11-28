import {SearchEntityId} from "~/server/search/index/internal/search_entity_id.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
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

// NOCOMMIT: Document this!
export type SearchEntityDependencyId =
    | `Account:${AccountId | ContentMentionAccountId}`
    | `Document:${DocumentId}:Content`
    | `Document:${DocumentId}:Title`
    | `DocumentComment:${DocumentId}-${DocumentCommentThreadId}-${number}:Payload`
    | `Channel:${ChannelId}:NameAndDescriptionContent`
    | `Channel:${ChannelId}:Preview`
    | `Post:${PostId}:Content`
    | `PostComment:${PostId}-${number}:Payload`
    | `Chat:${ChatId}:AccountIds`
    | `ChatMessage:${ChatId}-${number}:Payload`
    | `Task:${TaskId}`
    | `Task:${TaskId}:Authorization`
    | `TaskCollection:${TaskCollectionId}`
    | `TaskCollection:${TaskCollectionId}:Authorization`;

type RemoveSearchEntityDependencyIdAttribute<T> = T extends `${infer U}:${infer V}:${string}`
    ? `${U}:${V}`
    : T;

assertAssignableTypes<
    RemoveSearchEntityDependencyIdAttribute<SearchEntityDependencyId>,
    SearchEntityId
>();
