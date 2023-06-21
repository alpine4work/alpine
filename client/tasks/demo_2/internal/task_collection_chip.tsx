import {TaskCollectionChipBase} from "~/client/tasks/demo_2/internal/task_collection_chip_base";
import {LocalTaskCollection} from "~/client/tasks/demo_2/local_tasks_state";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing";

/**
 * At maximum width, two task collection chips should fit on a line. Subtract
 * the amount of gap between chips.
 */
export const taskCollectionChipContainerMaxWidth = `max(calc(50% - ${spacing["2.5"]}), ${
    (parseRemLengthNumber(spacing["96"]) - parseRemLengthNumber(spacing["2.5"])) / 2
}rem)`;

export function TaskCollectionChip({
    collection,
    onPress,
    onRemove,
}: {
    collection: LocalTaskCollection;
    onPress?: () => void;
    onRemove?: () => void;
}) {
    return (
        <TaskCollectionChipBase
            color={collection.color}
            name={collection.name}
            onPress={onPress}
            onRemove={onRemove}
        />
    );
}
