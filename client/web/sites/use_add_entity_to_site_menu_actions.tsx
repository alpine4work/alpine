import {FolderPlus, MagnifyingGlass} from "phosphor-react";
import {useMemo} from "react";
import {MenuActions} from "~/client/web/design/menu.js";
import {ChannelBrandIcon} from "~/client/web/icons/brand/channel_brand_icon.js";
import {DocumentBrandIcon} from "~/client/web/icons/brand/document_brand_icon.js";
import {TaskBrandIcon} from "~/client/web/icons/brand/task_brand_icon.js";
import {TaskCollectionBrandIcon} from "~/client/web/icons/brand/task_collection_brand_icon.js";
import {useSiteMutations} from "~/client/web/sites/internal/use_site_mutations.js";
import {OrderKey} from "~/shared/helpers/sort/order_key.open_source.js";
import {SiteContainerId} from "~/shared/sites/site_entry_id.js";

/**
 * Menu actions for adding an entity to a site. Returns four "Create new" rows
 * (Document, Task, Channel, TaskCollection), an optional Section row when
 * `onCreateSection` is supplied, and a "Search for existing" row that delegates to
 * the caller (via `onSearchExisting`) to surface a search modal.
 *
 * `getOrderKey` is invoked at press time so callers can compute the insert
 * position lazily (e.g. based on the latest sibling list).
 */
export function useAddEntityToSiteMenuActions({
    parentId,
    getOrderKey,
    onSearchExisting,
    onCreateSection,
}: {
    parentId: SiteContainerId;
    getOrderKey: () => OrderKey;
    onSearchExisting: () => void;
    onCreateSection?: () => void;
}): MenuActions {
    const {
        createDocumentInSite,
        createTaskInSite,
        createChannelInSite,
        createTaskCollectionInSite,
    } = useSiteMutations();

    return useMemo((): MenuActions => {
        const createNewActions = [
            {
                label: "Document",
                icon: <DocumentBrandIcon />,
                pressErrorTitle: "Couldn\u2019t create document",
                onPress: async () => {
                    await createDocumentInSite({parentId, orderKey: getOrderKey()});
                },
            },
            {
                label: "Task",
                icon: <TaskBrandIcon />,
                pressErrorTitle: "Couldn\u2019t create task",
                onPress: async () => {
                    await createTaskInSite({parentId, orderKey: getOrderKey()});
                },
            },
            {
                label: "Channel",
                icon: <ChannelBrandIcon />,
                pressErrorTitle: "Couldn\u2019t create channel",
                onPress: async () => {
                    await createChannelInSite({parentId, orderKey: getOrderKey()});
                },
            },
            {
                label: "Task collection",
                icon: <TaskCollectionBrandIcon />,
                pressErrorTitle: "Couldn\u2019t create task collection",
                onPress: async () => {
                    await createTaskCollectionInSite({parentId, orderKey: getOrderKey()});
                },
            },
        ];

        if (onCreateSection) {
            createNewActions.push({
                label: "Section",
                icon: <FolderPlus size={16} />,
                pressErrorTitle: "Couldn\u2019t create section",
                onPress: async () => {
                    onCreateSection();
                },
            });
        }

        return [
            {heading: "Create new", actions: createNewActions},
            {
                heading: "Or find existing",
                actions: [
                    {
                        label: "Search for existing…",
                        icon: <MagnifyingGlass size={16} />,
                        onPress: onSearchExisting,
                    },
                ],
            },
        ];
    }, [
        parentId,
        getOrderKey,
        onSearchExisting,
        onCreateSection,
        createDocumentInSite,
        createTaskInSite,
        createChannelInSite,
        createTaskCollectionInSite,
    ]);
}
