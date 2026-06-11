// TODO(#sites):
// https://app.graphite.com/github/pr/cyberworlds/cyberworlds/1465/site-data-model#comment-PRRC_kwDOH2ktg86826pe
import {InternalError, InvalidArgumentError} from "~/shared/error/error.js";
import {assertAssignableTypes} from "~/shared/helpers/control/assert_assignable_types.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {quote} from "~/shared/helpers/string/quote.js";
import {MergeObjectIntersection} from "~/shared/helpers/types/merge_object_intersection.js";
import {UnionToIntersection} from "~/shared/helpers/types/union_to_intersection.js";
import {assertId, isId} from "~/shared/id/id.js";
import {
    ChannelId,
    ChatId,
    DocumentId,
    TaskCollectionId,
    TaskId,
} from "~/shared/id/types/id_types.js";
import {Schema, SchemaDeserializationError} from "~/shared/schema/schema.js";
import {
    GetSearchEntityIdActualTestMapUnionType,
    SearchDynamicEntityIdObject,
    SearchEntityId,
    SearchMentionEntityId,
} from "~/shared/search/search_entity_id.js";

// NOTE(ifitzsimmons, 2026-03-05): These could also be called
// SearchEntityWithOwnAccessPolicyId the idea being that any entity with its own
// access policy can be added to a site. The only gotcha here is that a _site_ has
// its own access policy and sites cannot be nested. This feels like the right
// decision for now. If this evolves to the point where sites can be nested and
// every entity that is able to have its own access policy can be added to a site,
// then we can consider renaming this to SearchEntityWithOwnAccessPolicyId.
export type SiteItemSearchEntityId =
    | `Document:${DocumentId}`
    | `Channel:${ChannelId}`
    | `Chat:${ChatId}`
    | `Task:${TaskId}`
    | `TaskCollection:${TaskCollectionId}`;

assertAssignableTypes<SiteItemSearchEntityId, SearchMentionEntityId>();

export type SiteItemSearchEntityIdObject =
    | {readonly type: "Document"; readonly documentId: DocumentId}
    | {readonly type: "Channel"; readonly channelId: ChannelId}
    | {readonly type: "Chat"; readonly chatId: ChatId}
    | {readonly type: "Task"; readonly taskId: TaskId}
    | {readonly type: "TaskCollection"; readonly collectionId: TaskCollectionId};

assertAssignableTypes<SiteItemSearchEntityIdObject, SearchDynamicEntityIdObject>();

export const SiteItemSearchEntityIdSchema = Schema.string.transform<SiteItemSearchEntityId>({
    serialize: id => id,
    deserialize: id => {
        if (!isSiteItemSearchEntityId(id))
            throw new SchemaDeserializationError("Expected search entity id");

        return id;
    },
});

type GetSiteItemSearchEntityIdActualTestMapType<Id extends string> = MergeObjectIntersection<
    UnionToIntersection<GetSearchEntityIdActualTestMapUnionType<Id>>
>;

const siteItemSearchEntityIdTestMap: GetSiteItemSearchEntityIdActualTestMapType<SiteItemSearchEntityId> =
    {
        Document: isId,
        Channel: isId,
        Chat: isId,
        Task: isId,
        TaskCollection: isId,
    };
export type SiteItemSearchEntityType = keyof typeof siteItemSearchEntityIdTestMap;

export function isSiteItemSearchEntityId(id: string): id is SiteItemSearchEntityId {
    const [idType = "", idRest = ""] = id.split(":", 2);
    const idTest = cast<{[key: string]: ((idRest: string) => boolean) | null}>(
        siteItemSearchEntityIdTestMap,
    )[idType];

    if (idTest === undefined) return false;

    if (idTest === null) {
        // Implies that `idRest` is an empty string.
        return id === idType;
    }

    return idTest(idRest);
}

export function assertSiteItemSearchEntityId(entityId: SearchEntityId): SiteItemSearchEntityId {
    if (isSiteItemSearchEntityId(entityId)) return entityId;
    throw new InvalidArgumentError("Entity Id is not a site item search entity ID");
}

export function parseSiteItemSearchEntityId(
    id: SiteItemSearchEntityId,
): SiteItemSearchEntityIdObject {
    const [idType, idPayload] = id.split(":");
    const idPayloadParts = idPayload?.split("-") ?? [];

    const idString = assertExists(idPayloadParts[0]);
    switch (idType) {
        case "Document":
            return {type: "Document", documentId: assertId<DocumentId>(idString)};
        case "Channel":
            return {type: "Channel", channelId: assertId<ChannelId>(idString)};
        case "Chat":
            return {type: "Chat", chatId: assertId<ChatId>(idString)};
        case "Task":
            return {type: "Task", taskId: assertId<TaskId>(idString)};
        case "TaskCollection":
            return {
                type: "TaskCollection",
                collectionId: assertId<TaskCollectionId>(idString),
            };
        default:
            throw new InternalError(
                quote`Unrecognized \`SiteItemSearchEntityId\` type ${idType ?? ""}`,
            );
    }
}

export function parseSiteItemSearchEntityIdIfPossible(
    id: string,
): SiteItemSearchEntityIdObject | null {
    if (!isSiteItemSearchEntityId(id)) return null;

    return parseSiteItemSearchEntityId(id);
}
