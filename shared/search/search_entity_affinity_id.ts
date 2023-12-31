import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {SearchEntityId} from "~/shared/search/search_entity_id.js";

/**
 * `SearchEntityId`s that we record affinity points for. Not every search
 * entity has affinity points. Notably comments or chat messages don't get
 * affinity points. Entities with a long lifespan that the user will likely
 * want to find again get affinity points.
 *
 * Posts are not given affinity points. Posts are designed to be short lived
 * and probably don't have a lifespan beyond a couple days. Even if a post
 * receives heated conversation. Posts live and die by the inbox. If a post
 * receives new comments, you'll be reminded of it. Otherwise it's ok for posts
 * to fade into obscurity.
 */
export type SearchEntityAffinityId =
    | `Account:${AccountId}`
    | `Document:${DocumentId}`
    | `Channel:${ChannelId}`
    | `Chat:${ChatId}`
    | `Task:${TaskId}`
    | `TaskCollection:${TaskCollectionId}`
    // You can build affinity with your task notepad even though we don't index
    // a search entity doc for it.
    | "TaskNotepad";

assertAssignableTypes<Exclude<SearchEntityAffinityId, "TaskNotepad">, SearchEntityId>();

export const SearchEntityAffinityIdSchema = Schema.string as Schema<SearchEntityAffinityId>;

export type SearchEntityIdOrSearchAffinityId = SearchEntityId | SearchEntityAffinityId;

export const SearchEntityIdOrSearchAffinityIdSchema =
    Schema.string as Schema<SearchEntityIdOrSearchAffinityId>;
