import {FileChatEntityModelSchema} from "~/shared/chat/file_chat_entity_model_schema.js";
import {RouteLayout} from "~/shared/design/core/route_layout.js";
import {FileDocumentEntityModelSchema} from "~/shared/documents/file_document_entity_model_schema.js";
import {FileEntityId, parseFileEntityId} from "~/shared/files/file_entity_id.js";
import {FileEntityModel, FileEntityModelResult} from "~/shared/files/file_entity_model.js";
import {FileChannelEntityModelSchema} from "~/shared/forum/file_channel_entity_model_schema.js";
import {FilePostEntityModelSchema} from "~/shared/forum/file_post_entity_model_schema.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {StableRandom} from "~/shared/helpers/number/stable_random.js";
import {unsafelyGenerateStableChronologicalId} from "~/shared/id/chronological_id.js";
import {unsafelyGenerateStableId} from "~/shared/id/id.js";
import {SiteId, SpaceId} from "~/shared/id/types/id_types.js";
import {
    SearchDynamicEntityIdObject,
    SearchDynamicEntityType,
    SearchStaticEntityId,
} from "~/shared/search/search_entity_id.js";
import {SearchEntityModelDataWithAccount} from "~/shared/search/search_entity_model.js";
import {
    SiteItemSearchEntityId,
    parseSiteItemSearchEntityId,
} from "~/shared/search/site_item_search_entity_id.js";
import {FileSiteEntityModelSchema} from "~/shared/sites/file_site_entity_model_schema.js";
import {FileTaskCollectionEntityModelSchema} from "~/shared/tasks/file_task_collection_entity_model.js";
import {FileTaskEntityModelSchema} from "~/shared/tasks/file_task_entity_model.js";
import {serializeTaskQueryFiltersSearchParam} from "~/shared/tasks/task_query_filter.js";
import {serializeTaskQuerySortsSearchParam} from "~/shared/tasks/task_query_sort.js";

export function getSearchEntityPath({
    spaceId,
    entityData,
    randomSeed,
    currentTime,
    routeLayout,
}: {
    spaceId: SpaceId;
    entityData: SearchEntityModelDataWithAccount;
    randomSeed: string;
    currentTime: Date;
    routeLayout: RouteLayout;
}): string {
    if (entityData.type === "Static") {
        return getSearchStaticEntityPath({
            spaceId,
            entityId: entityData.id,
            randomSeed,
            currentTime,
        });
    }

    return getSearchDynamicEntityPath(spaceId, entityData, routeLayout);
}

export function getSearchDynamicEntityPath(
    spaceId: SpaceId,
    entityData: SearchEntityModelDataWithAccount & {type: SearchDynamicEntityType},
    // We may use this in the future, so we keep the parameter to avoid changing all
    // call sites.
    _routeLayout: RouteLayout,
): string {
    if (entityData.type === "Site") {
        return getSearchDynamicEntityPathFromEntityIdObject(
            spaceId,
            {
                type: "Site",
                siteId: entityData.site.id,
                firstEntityId: entityData.site.firstEntityId,
            },
            _routeLayout,
        );
    }

    return getSearchDynamicEntityPathFromEntityIdObject(
        spaceId,
        intoSearchDynamicEntityIdObject(entityData),
        _routeLayout,
    );
}

export function getSearchDynamicEntityPathFromEntityIdObject(
    spaceId: SpaceId,
    entityId:
        | Exclude<SearchDynamicEntityIdObject, {type: "Site"}>
        | {
              type: "Site";
              siteId: SiteId;
              firstEntityId: SiteItemSearchEntityId | null;
          },
    // We may use this in the future, so we keep the parameter to avoid changing all
    // call sites.
    _routeLayout: RouteLayout,
): string {
    switch (entityId.type) {
        case "Account": {
            // NOTE(calebmer): Eventually I'd like to have a profile page for accounts. Since
            // we don't currently have that, route to a 1:1 chat with the account.
            //
            // Though even if we had a profile page for accounts, routing to the 1:1 chat in
            // search may be more useful.
            return `/chat/with/${entityId.accountId}/${spaceId}?focus`;
        }
        case "Document": {
            return `/doc/${entityId.documentId}`;
        }
        case "DocumentComment": {
            return `/doc/${entityId.documentId}?thread=${entityId.commentThreadId}&comment=${entityId.commentIndex}`;
        }
        case "Channel": {
            return `/channel/${entityId.channelId}`;
        }
        case "Post": {
            return `/post/${entityId.postId}`;
        }
        case "PostComment": {
            return `/post/${entityId.postId}?comment=${entityId.commentIndex}`;
        }
        case "Chat": {
            return `/chat/${entityId.chatId}`;
        }
        case "ChatMessage": {
            return `/chat/${entityId.chatId}?message=${entityId.messageIndex}`;
        }
        case "Task": {
            return `/task/${entityId.taskId}`;
        }
        case "TaskCollection": {
            return `/task-collection/${entityId.collectionId}`;
        }
        case "TaskComment": {
            return `/task/${entityId.taskId}?comment=${entityId.commentIndex}`;
        }
        case "Site": {
            if (entityId.firstEntityId === null) {
                return `/site/${entityId.siteId}`;
            }

            const idObject = parseSiteItemSearchEntityId(entityId.firstEntityId);
            return getSearchDynamicEntityPathFromEntityIdObject(spaceId, idObject, _routeLayout);
        }
        default:
            throw exhaustive(entityId);
    }
}

export function getSearchStaticEntityPath({
    spaceId,
    entityId,
    randomSeed,
    currentTime,
}: {
    spaceId: SpaceId;
    entityId: SearchStaticEntityId;
    randomSeed: string;
    currentTime: Date;
}): string {
    const getStableRandom = () => new StableRandom(`getSearchEntityPath:${randomSeed}`);

    switch (entityId) {
        case "CreateChatMessage": {
            return `/chat/new/${spaceId}`;
        }
        case "CreatePost": {
            // Make sure we use the same `draftId` consistently for the current search result
            // list.
            const draftId = unsafelyGenerateStableChronologicalId(
                getStableRandom(),
                entityId,
                currentTime.getTime(),
            );

            return `/post/new/${draftId}/${spaceId}`;
        }
        case "CreateChannel": {
            return `/channel/new/${spaceId}?focus=none`;
        }
        case "CreateDocument": {
            // Make sure we use the same `documentId` consistently for the current search
            // result list.
            const documentId = unsafelyGenerateStableId(getStableRandom(), entityId);

            // Documents are only created once the user starts typing in them. The user doesn't
            // create a document every time they navigate to this search route.
            return `/doc/${documentId}?create=${spaceId}`;
        }
        case "CreateTaskCollection": {
            // Make sure we use the same `collectionId` consistently for the current search
            // result list.
            const collectionId = unsafelyGenerateStableId(getStableRandom(), entityId);

            return `/task-collection/${collectionId}?create=${spaceId}&focus=none`;
        }
        case "CreateTaskView": {
            return `/task-view/new/${spaceId}`;
        }
        case "CreateTask": {
            // Make sure we use the same `taskId` consistently for the current search result
            // list.
            const taskId = unsafelyGenerateStableId(getStableRandom(), entityId);

            return `/task/${taskId}?create=${spaceId}`;
        }
        case "TaskPersonal": {
            return `/my-tasks/${spaceId}`;
        }
        case "TaskQueryFilteredToCreatorIsCurrentAccount": {
            const nameSearchParam = encodeURIComponent("Tasks I\u2019ve created");

            const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
            ]);

            const sortsSearchParam = serializeTaskQuerySortsSearchParam([
                {
                    type: "CreatedTime",
                    direction: "Descending",
                },
            ]);

            return `/task-view/new/${spaceId}?name=${nameSearchParam}&filter=${filtersSearchParam}&sort=${sortsSearchParam}`;
        }
        case "TaskQueryFilteredToAssigneeIsCurrentAccount": {
            const nameSearchParam = encodeURIComponent("Tasks assigned to me");

            const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
                {
                    type: "Assignee",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
            ]);

            const sortsSearchParam = serializeTaskQuerySortsSearchParam([
                {
                    type: "CreatedTime",
                    direction: "Descending",
                },
            ]);

            return `/task-view/new/${spaceId}?name=${nameSearchParam}&filter=${filtersSearchParam}&sort=${sortsSearchParam}`;
        }
        case "TaskQueryFilteredToAssigneeIsCurrentAccountAndAssigneeStatusIsActive": {
            const nameSearchParam = encodeURIComponent("Active tasks assigned to me");

            const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
                {
                    type: "Assignee",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
                {
                    type: "DisplayStatus",
                    operation: {
                        type: "OneOf",
                        displayStatuses: new Set(["OpenActive"]),
                    },
                },
            ]);

            const sortsSearchParam = serializeTaskQuerySortsSearchParam([
                {
                    type: "ActivatedTime",
                    direction: "Descending",
                },
            ]);

            return `/task-view/new/${spaceId}?name=${nameSearchParam}&filter=${filtersSearchParam}&sort=${sortsSearchParam}`;
        }
        case "TaskQueryFilteredToAssignerIsCurrentAccount": {
            const nameSearchParam = encodeURIComponent("Tasks I\u2019ve assigned to others");

            const filtersSearchParam = serializeTaskQueryFiltersSearchParam([
                {
                    type: "Creator",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
                {
                    type: "Assigner",
                    operation: {
                        type: "OneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
                {
                    type: "Assignee",
                    operation: {
                        type: "NoneOf",
                        accounts: [{type: "CurrentAccount"}],
                    },
                },
            ]);

            const sortsSearchParam = serializeTaskQuerySortsSearchParam([
                {
                    type: "CreatedTime",
                    direction: "Descending",
                },
            ]);

            return `/task-view/new/${spaceId}?name=${nameSearchParam}&filter=${filtersSearchParam}&sort=${sortsSearchParam}`;
        }
        case "SearchFavorites": {
            return `/favorites/${spaceId}`;
        }
        default: {
            throw exhaustive(entityId);
        }
    }
}

function intoSearchDynamicEntityIdObject(
    entity: SearchEntityModelDataWithAccount & {type: SearchDynamicEntityType},
):
    | Exclude<SearchDynamicEntityIdObject, {type: "Site"}>
    | {
          type: "Site";
          siteId: SiteId;
          firstEntityId: SiteItemSearchEntityId | null;
      } {
    switch (entity.type) {
        case "Account": {
            return {type: "Account", accountId: entity.account.id} as const;
        }
        case "Channel": {
            return {type: "Channel", channelId: entity.channel.id};
        }
        case "Chat": {
            return {type: "Chat", chatId: entity.chat.id};
        }
        case "Document": {
            return {type: "Document", documentId: entity.document.id} as const;
        }
        case "Post": {
            return {type: "Post", postId: entity.post.id};
        }
        case "Task": {
            return {type: "Task", taskId: entity.task.id};
        }
        case "TaskCollection": {
            return {type: "TaskCollection", collectionId: entity.collection.id};
        }
        case "Site": {
            return {type: "Site", siteId: entity.site.id, firstEntityId: entity.site.firstEntityId};
        }
        case "ChatMessage": {
            return {
                type: "ChatMessage",
                chatId: entity.message.chatId,
                messageIndex: entity.message.index,
            };
        }
        case "DocumentComment": {
            return {
                type: "DocumentComment",
                documentId: entity.comment.documentId,
                commentThreadId: entity.comment.commentThreadId,
                commentIndex: entity.comment.index,
            };
        }
        case "PostComment": {
            return {
                type: "PostComment",
                postId: entity.comment.postId,
                commentIndex: entity.comment.index,
            };
        }
        case "TaskComment": {
            return {
                type: "TaskComment",
                taskId: entity.comment.taskId,
                commentIndex: entity.comment.index,
            };
        }
        default: {
            throw exhaustive(entity);
        }
    }
}

export function getDynamicSearchEntityPathForFileEntity({
    spaceId,
    fileEntityId,
    fileEntityResult,
}: {
    spaceId: SpaceId;
    fileEntityId: FileEntityId;
    // Required + nullable (rather than optional) so callers must make a deliberate
    // decision: pass the loaded entity result, or explicitly `null` to fall back to
    // the wide-path heuristic derived from the id alone.
    fileEntityResult: FileEntityModelResult | null;
}): string {
    if (!fileEntityResult || !fileEntityResult.ok) {
        const idObject = parseFileEntityId(fileEntityId);
        return getSearchDynamicEntityPathFromEntityIdObject(
            spaceId,
            idObject.type === "Site"
                ? {type: "Site", siteId: idObject.siteId, firstEntityId: null}
                : idObject,
            "wide",
        );
    }

    const fileEntity = fileEntityResult.value;

    switch (fileEntity.type) {
        case "Channel":
        case "Chat":
        case "Document":
        case "Post":
        case "Task":
        case "TaskCollection": {
            const idObject = parseFileEntityId(fileEntityId);
            assert(idObject.type === fileEntity.type);
            return getSearchDynamicEntityPathFromEntityIdObject(spaceId, idObject, "wide");
        }
        case "Site": {
            const idObject = parseFileEntityId(fileEntityId);
            assert(idObject.type === fileEntity.type);

            const fileEntityData = fileEntity.deserialize(FileSiteEntityModelSchema);

            if (!fileEntityData.firstEntity) {
                return getSearchDynamicEntityPathFromEntityIdObject(
                    spaceId,
                    {type: "Site", siteId: idObject.siteId, firstEntityId: null},
                    "wide",
                );
            }

            const firstEntityIdObject = getSearchEntityIdObjectFromFileEntity(
                fileEntityData.firstEntity,
            );
            assert(firstEntityIdObject.type !== "Site");

            return getSearchDynamicEntityPathFromEntityIdObject(
                spaceId,
                firstEntityIdObject,
                "wide",
            );
        }

        default: {
            throw exhaustive(fileEntity.type);
        }
    }
}

function getSearchEntityIdObjectFromFileEntity(
    fileEntity: FileEntityModel,
): SearchDynamicEntityIdObject {
    switch (fileEntity.type) {
        case "Channel": {
            const fileEntityData = fileEntity.deserialize(FileChannelEntityModelSchema);
            return {type: "Channel", channelId: fileEntityData.id};
        }
        case "Chat": {
            const fileEntityData = fileEntity.deserialize(FileChatEntityModelSchema);
            return {type: "Chat", chatId: fileEntityData.id};
        }
        case "Document": {
            const fileEntityData = fileEntity.deserialize(FileDocumentEntityModelSchema);
            return {type: "Document", documentId: fileEntityData.id};
        }
        case "Post": {
            const fileEntityData = fileEntity.deserialize(FilePostEntityModelSchema);
            return {type: "Post", postId: fileEntityData.id};
        }
        case "Task": {
            const fileEntityData = fileEntity.deserialize(FileTaskEntityModelSchema);
            return {type: "Task", taskId: fileEntityData.task.id};
        }
        case "TaskCollection": {
            const fileEntityData = fileEntity.deserialize(FileTaskCollectionEntityModelSchema);
            return {type: "TaskCollection", collectionId: fileEntityData.collection.id};
        }
        case "Site": {
            const fileEntityData = fileEntity.deserialize(FileSiteEntityModelSchema);
            return {type: "Site", siteId: fileEntityData.id};
        }
        default: {
            throw exhaustive(fileEntity.type);
        }
    }
}
