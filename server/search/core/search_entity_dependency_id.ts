import {SearchEntityId} from "~/shared/search/search_entity_id.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    ContentMentionAccountId,
    DocumentId,
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
 *
 * You can't take a dependency on every search entity. For example
 * `ChatMessage:${ChatId}:${number}` is a `SearchEntityId` but not a
 * `SearchEntityDependencyId`. That means we statically know that when a
 * chat message changes it has no dependents so we can skip querying for
 * dependents.
 *
 * In theory every `SearchEntityId` could be a `SearchEntityDependencyId`. We
 * statically limit `SearchEntityDependencyId` as an optimization.
 */
export type SearchEntityDependencyId =
    | `Account:${AccountId | ContentMentionAccountId}`
    | `Document:${DocumentId}:Title`
    | `Channel:${ChannelId}:Preview`
    | `Chat:${ChatId}`
    | `Task:${TaskId}:Authorization`
    | `TaskCollection:${TaskCollectionId}:Authorization`;

type RemoveSearchEntityDependencyIdAttribute<Id> =
    Id extends `${infer IdType}:${infer IdPayload}:${string}` ? `${IdType}:${IdPayload}` : Id;

// The prefix of `SearchEntityDependencyId` should be a `SearchEntityId`.
assertAssignableTypes<
    RemoveSearchEntityDependencyIdAttribute<SearchEntityDependencyId>,
    SearchEntityId
>();

type ExtractSearchEntityDependencyIdType<Id> = Id extends `${infer IdType}:${string}`
    ? IdType
    : never;

const searchEntityIdTypesThatAreAlsoEntityDependencyIds: {
    [Key in ExtractSearchEntityDependencyIdType<
        Exclude<SearchEntityDependencyId, `${string}:${string}:${string}`>
    >]: true;
} = {
    Account: true,
    Chat: true,
};

/**
 * Is the provided `SearchEntityDependencyId` also a valid `SearchEntityId`?
 *
 * For example, `Chat:${ChatId}` is both a `SearchEntityDependencyId` and
 * `SearchEntityId`. We'd return true for `Chat:${ChatId}`. However
 * `Document:${DocumentId}:Title` is a `SearchEntityDependencyId` but not a
 * `SearchEntityId` so we'd return false.
 */
export function isSearchEntityDependencyIdAlsoEntityId(
    entityId: SearchEntityId | SearchEntityDependencyId,
): entityId is SearchEntityId {
    return entityId.indexOf(":") === entityId.lastIndexOf(":");
}

/**
 * Is the provided `SearchEntityId` also a valid `SearchEntityDependencyId`?
 *
 * For example, `Chat:${ChatId}` is both a `SearchEntityDependencyId` and
 * `SearchEntityId`. We'd return true for `Chat:${ChatId}`. However
 * `ChatMessage:${ChatId}:${number}` is a `SearchEntityId` but not a
 * `SearchEntityDependencyId` so we'd return false.
 */
export function isSearchEntityIdAlsoEntityDependencyId(
    entityId: SearchEntityId,
): entityId is Exclude<SearchEntityDependencyId, `${string}:${string}:${string}`> {
    const entityType = entityId.slice(0, entityId.indexOf(":"));

    return (
        cast<{[key: string]: boolean}>(searchEntityIdTypesThatAreAlsoEntityDependencyIds)[
            entityType
        ] ?? false
    );
}
