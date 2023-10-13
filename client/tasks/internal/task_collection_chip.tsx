import {Store} from "~/client/helpers/store/store.js";
import {useStore} from "~/client/helpers/store/use_store.js";
import {TaskCollectionChipBase} from "~/client/tasks/internal/task_collection_chip_base.js";
import {TaskClientStoreCollectionEntry} from "~/client/tasks/task_client_store.js";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";

/**
 * At maximum width, two task collection chips should fit on a line. Subtract
 * the amount of gap between chips.
 */
export const taskCollectionChipContainerMaxWidth = `max(calc(50% - ${spacing["2.5"]}), ${
    (parseRemLengthNumber(spacing["96"]) - parseRemLengthNumber(spacing["2.5"])) / 2
}rem)`;

export function TaskCollectionChip({
    collectionEntryStore,
    onPress,
    onRemove,
}: {
    collectionEntryStore: Store<TaskClientStoreCollectionEntry>;
    onPress?: () => void;
    onRemove?: () => void;
}) {
    const collectionEntry = useStore(collectionEntryStore);

    return (
        <TaskCollectionChipBase
            color={collectionEntry.collection?.getColor() ?? null}
            name={collectionEntry.collection?.getName() ?? ""}
            onPress={onPress}
            onRemove={onRemove}
        />
    );
}
