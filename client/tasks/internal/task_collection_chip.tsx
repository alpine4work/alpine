import {TaskCollectionChipBase} from "~/client/tasks/internal/task_collection_chip_base.js";
import {Spacing, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";

/**
 * At maximum width, two task collection chips should fit on a line. Subtract
 * the amount of gap between chips.
 */
export const taskCollectionChipContainerMaxWidth = `max(calc(50% - ${spacing["2.5"]}), ${
    (parseRemLengthNumber(spacing["96"]) - parseRemLengthNumber(spacing["2.5"])) / 2
}rem)`;

export function TaskCollectionChip({
    collection,
    nameMaxWidth,
    tabIndex,
    onPress,
    onRemove,
}: {
    collection: TaskCollectionModel | null;
    nameMaxWidth?: Spacing;
    tabIndex?: number;
    onPress?: () => void;
    onRemove?: () => void;
}) {
    return (
        <TaskCollectionChipBase
            color={collection?.getColor() ?? null}
            name={collection?.getName() ?? ""}
            nameMaxWidth={nameMaxWidth}
            tabIndex={tabIndex}
            onPress={onPress}
            onRemove={onRemove}
        />
    );
}
