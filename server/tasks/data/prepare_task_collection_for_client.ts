import {TaskCollectionIndexDoc} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";

export function prepareTaskCollectionForClient(
    collection: TaskCollectionIndexDoc,
): TaskCollectionModel {
    return new TaskCollectionModel({
        id: collection.id,
        spaceId: collection.spaceId,
        createdTime: collection.createdTime,
        deletedTime: collection.rawDeletedTime,
        undeletedTime: collection.rawUndeletedTime,
        name: collection.name,
        color: collection.color,
        accessPolicy: collection.accessPolicy,
    });
}
