import {SearchEntityId} from "~/server/search/core/search_entity_id.js";
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

/**
 * Reference to a search entity or some subset of attributes on a search
 * entity. Used for recording the dependencies of a search indexing job. So
 * when the entity updates we can re-run our search indexing job with the new
 * data.
 *
 * We allow you to specify a dependency on some "trait" of the search entity.
 * A trait is a subset of attributes on the object. For example the
 * `Authorization` trait on `Task` includes all attributes relevant to
 * authorization (assignee, parent task, and collections) and excludes all
 * attributes irrelevant to authorization (title, notes, priority, etc.).
 * Depending on just the authorization trait is an optimization that lets us
 * avoid re-indexing whenever unrelated attributes change.
 */
export type SearchEntityDependencyId =
    | `Account:${AccountId | ContentMentionAccountId}`
    | `Document:${DocumentId}`
    | `Document:${DocumentId}:Title`
    | `DocumentComment:${DocumentId}-${DocumentCommentThreadId}-${number}`
    | `Channel:${ChannelId}`
    | `Channel:${ChannelId}:Preview`
    | `Post:${PostId}`
    | `PostComment:${PostId}-${number}`
    | `Chat:${ChatId}`
    | `ChatMessage:${ChatId}-${number}`
    | `Task:${TaskId}`
    | `Task:${TaskId}:Authorization`
    | `TaskCollection:${TaskCollectionId}`
    | `TaskCollection:${TaskCollectionId}:Authorization`;

type RemoveSearchEntityDependencyIdAttribute<Id> =
    Id extends `${infer IdType}:${infer IdPayload}:${string}` ? `${IdType}:${IdPayload}` : Id;

// The prefix of `SearchEntityDependencyId` should be a `SearchEntityId`.
assertAssignableTypes<
    RemoveSearchEntityDependencyIdAttribute<SearchEntityDependencyId>,
    SearchEntityId
>();
