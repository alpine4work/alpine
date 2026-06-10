import {TaskCollectionIndexDocBase} from "~/server/tasks/data/task_collection_index_doc.js";
import {TaskCollectionId} from "~/shared/id/types/id_types.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";

export function prepareTaskCollectionForClient(
    collection: TaskCollectionIndexDocBase & {id: TaskCollectionId},
): TaskCollectionModel {
    return new TaskCollectionModel({
        id: collection.id,
        spaceId: collection.spaceId,
        createdTime: collection.createdTime,
        creator:
            collection.creatorId === null
                ? null
                : {
                      accountId: collection.creatorId,
                      from: collection.creatorFrom,
                  },
        deletedTime: collection.rawDeletedTime,
        undeletedTime: collection.rawUndeletedTime,
        name: collection.name,
        color: collection.color,
        accessPolicy: collection.accessPolicy,
    });
}
