import {useMemo} from "react";
import {useStore} from "~/client/web/helpers/use_store.js";
import {TaskClientReadonlyStore} from "~/client/web/tasks/core/task_client_store.js";
import {TaskCollectionChipBase} from "~/client/web/tasks/task_collection_chip_base.js";
import {Spacing, parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {ConstStore} from "~/shared/store/const_store.js";
import {TaskCollectionModel} from "~/shared/tasks/model/task_collection_model.js";

/**
 * At maximum width, two task collection chips should fit on a line. Subtract the
 * amount of gap between chips.
 */
export const taskCollectionChipContainerMaxWidth = `max(calc(50% - ${spacing["2.5"]}), ${
    (parseRemLength("96") - parseRemLength("2.5")) / 2
}rem)`;

export function TaskCollectionChip({
    store,
    collection,
    nameMaxWidth,
    withDesktopLayout,
    tabIndex,
    onPress,
    onRemove,
}: {
    store: TaskClientReadonlyStore;
    collection: TaskCollectionModel;
    nameMaxWidth?: Spacing;
    withDesktopLayout?: boolean;
    tabIndex?: number;
    onPress?: () => void;
    onRemove?: () => void;
}) {
    const isPrivate = useStore(
        useMemo(() => {
            const accessPolicy = collection.getAccessPolicy();

            switch (accessPolicy.type) {
                case "Local":
                    return new ConstStore(!accessPolicy.defaultGrant);
                case "Site":
                    const siteStore = store.getReferencedSiteStoreAndAssertExists(
                        accessPolicy.siteId,
                    );

                    return siteStore.map(site => !site.accessPolicy.defaultGrant);
                default:
                    throw exhaustive(accessPolicy);
            }
        }, [collection, store]),
    );

    return (
        <TaskCollectionChipBase
            color={collection.getColor()}
            isPrivate={isPrivate}
            name={collection.getName()}
            nameMaxWidth={nameMaxWidth}
            withDesktopLayout={withDesktopLayout}
            tabIndex={tabIndex}
            onPress={onPress}
            onRemove={onRemove}
        />
    );
}
