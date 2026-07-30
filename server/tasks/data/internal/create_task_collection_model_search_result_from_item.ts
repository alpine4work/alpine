import {ServerActionContext} from "~/server/context/server_action_context.js";
import {getSitePreview} from "~/server/sites/data/get_site_preview.js";
import type {TaskCollectionEssentialAttributesItem} from "~/server/tasks/data/internal/task_table.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";
import {TaskCollectionModelSearchResult} from "~/shared/tasks/model/task_collection_model_search_result.js";

export async function createTaskCollectionModelSearchResultFromItem(
    context: ServerActionContext,
    collectionItem: TaskCollectionEssentialAttributesItem,
): Promise<TaskCollectionModelSearchResult> {
    return {
        openTaskCount: collectionItem.openTaskCount,
        lastTaskAddedTime: collectionItem.lastTaskAddedTime,
        collection: new TaskCollectionModel({
            id: collectionItem.collectionId,
            spaceId: collectionItem.spaceId,
            createdTime: collectionItem.createdTime,
            creator:
                collectionItem.creatorId === null
                    ? null
                    : {
                          accountId: collectionItem.creatorId,
                          from: collectionItem.creatorFrom,
                      },
            deletedTime: collectionItem.rawDeletedTime,
            undeletedTime: collectionItem.rawUndeletedTime,
            name: collectionItem.name,
            color: collectionItem.color,
            accessPolicy: collectionItem.accessPolicy,
            defaults: collectionItem.defaults,
        }),
        referencedAccessPolicySite:
            collectionItem.accessPolicy.value.type === "Site"
                ? await getSitePreview(context, collectionItem.accessPolicy.value.siteId)
                : null,
    };
}
