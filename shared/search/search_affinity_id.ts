import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {UnionToIntersection} from "~/shared/helpers/types/union_to_intersection.js";
import {
    AccountId,
    ChannelId,
    ChatId,
    DocumentId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {Schema} from "~/shared/schema/schema.js";
import {SearchCommandId} from "~/shared/search/search_commands.js";
import {SearchEntityId} from "~/shared/search/search_entity_id.js";
import {SearchResultId} from "~/shared/search/search_result.js";

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
export type SearchAffinityId =
    | `Account:${AccountId}`
    | `Document:${DocumentId}`
    | `Channel:${ChannelId}`
    | `Chat:${ChatId}`
    | `Task:${TaskId}`
    | `TaskCollection:${TaskCollectionId}`
    // You can build affinity with your task notepad even though we don't index
    // a search entity doc for it.
    | "TaskNotepad"
    | "TaskPersonal";

// Make sure `SearchAffinityId`s are valid `SearchEntityId`s (excluding
// `TaskNotepad`).
assertAssignableTypes<Exclude<SearchAffinityId, "TaskNotepad" | "TaskPersonal">, SearchEntityId>();

// Make sure there's no overlap between `SearchAffinityId` and `SearchCommandId`
// (excluding `TaskNotepad`).
assertEqualTypes<
    Exclude<SearchAffinityId, "TaskNotepad" | "TaskPersonal"> & SearchCommandId,
    never
>();

export const SearchAffinityIdSchema = Schema.string as Schema<SearchAffinityId>;

type GetSearchAffinityIdTestMapUnionType<Id extends string> = Id extends `${infer IdType}:${string}`
    ? Record<IdType, true>
    : Record<Id, false>;

type GetSearchAffinityIdTestMapType<Id extends string> = MergeObjectIntersection<
    UnionToIntersection<GetSearchAffinityIdTestMapUnionType<Id>>
>;

const searchAffinityIdTestMap: GetSearchAffinityIdTestMapType<SearchAffinityId> = {
    Account: true,
    Document: true,
    Channel: true,
    Chat: true,
    Task: true,
    TaskCollection: true,
    TaskNotepad: false,
    TaskPersonal: false,
};

/**
 * Is the provided `SearchResultId` a valid `SearchAffinityId`?
 */
export function isSearchAffinityId(id: SearchResultId): id is SearchAffinityId {
    const [idType = "", idRest = ""] = id.split(":", 2);
    const idTest = cast<{[key: string]: boolean}>(searchAffinityIdTestMap)[idType];

    if (idTest === undefined) return false;

    if (idTest) {
        return idRest.length > 0;
    } else {
        // Implies that `idRest` is an empty string.
        return id === idType;
    }
}
