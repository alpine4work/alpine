import {TaskCollectionChipBase} from "~/client/tasks/demo_2/internal/task_collection_chip_base";
import {LocalTaskCollection} from "~/client/tasks/demo_2/local_task_collection";

export function TaskCollectionChip({collection}: {collection: LocalTaskCollection}) {
    return <TaskCollectionChipBase color={collection.color} name={collection.name} />;
}
