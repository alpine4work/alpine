import {Trash} from "phosphor-react";
import {ReactNode} from "react";
import {PencilSimpleSlashIcon} from "~/client/icons/pencil_simple_slash_icon.js";
import {TaskClientStore} from "~/client/tasks/core/task_client_store.js";
import {
    TaskAccess,
    getTaskCollectionEntryAccess,
} from "~/client/tasks/internal/create_task_entry_access_store.js";
import {createTaskQueryCollectionsFilterCollectionResultsStore} from "~/client/tasks/internal/create_task_query_collections_filter_collection_results_store.js";
import {hasAccessLevel} from "~/shared/access/access_policy.js";
import {filterMapArray} from "~/shared/helpers/array/filter_map_array.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {Store} from "~/shared/store/store.js";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter.js";
import {TaskQueryFilterReferences} from "~/shared/tasks/task_query_filter_references.js";

/**
 * Determine whether our query is read-only. The query is read-only if one of
 * the filtered collections is read-only. The user may then remove the
 * collection causing the query to be read-only.
 */
export function createTaskQueryViewReadOnlyReasonStore({
    store,
    filters,
    filterReferences,
    currentAccount,
}: {
    store: TaskClientStore;
    filters: ReadonlyArray<TaskQueryFilter>;
    filterReferences: TaskQueryFilterReferences;
    currentAccount: AccountModel | null;
}): Store<{
    icon: ReactNode;
    message: string;
} | null> {
    const filterCollectionsLowestAccess = Store.many(
        filterMapArray(filters, filter => {
            if (filter.type !== "Collections") return;

            return createTaskQueryCollectionsFilterCollectionResultsStore({
                store,
                filter,
                filterReferences,
            }).map(collectionResults =>
                collectionResults.map(collectionResult =>
                    getTaskCollectionEntryAccess(currentAccount?.id, collectionResult.entry),
                ),
            );
        }),
    ).map(_accesses => {
        const accesses = _accesses.flat();

        let lowestAccess: TaskAccess = {type: "PermissionGranted", level: "Manage"};

        for (const access of accesses) {
            switch (access.type) {
                case "PermissionDenied": {
                    lowestAccess = access;
                    break;
                }
                case "Deleted": {
                    if (lowestAccess.type === "PermissionDenied") break;
                    lowestAccess = access;
                    break;
                }
                case "PermissionGranted": {
                    if (lowestAccess.type === "PermissionDenied") break;
                    if (lowestAccess.type === "Deleted") break;

                    if (!hasAccessLevel(access.level, lowestAccess.level)) {
                        lowestAccess = access;
                    }
                    break;
                }
                default:
                    throw exhaustive(access);
            }
        }

        return lowestAccess;
    });

    return filterCollectionsLowestAccess.map(access => {
        switch (access.type) {
            case "Deleted": {
                return {
                    icon: <Trash />,
                    message: "A filtered collection was deleted. You can’t make changes",
                };
            }
            case "PermissionDenied": {
                // TODO(calebmer): If the user removed their own access by removing a
                // collection or changing the assignee, we should hint to them that they're
                // allowed to undo and give them an undo button.
                return {
                    icon: <PencilSimpleSlashIcon />,
                    message: "You’ve lost access to a filtered collection. You can’t make changes",
                };
            }
            case "PermissionGranted": {
                if (hasAccessLevel(access.level, "Edit")) return null;

                // TODO(calebmer): If the user removed their own access by removing a
                // collection or changing the assignee, we should hint to them that they're
                // allowed to undo and give them an undo button.
                return {
                    icon: <PencilSimpleSlashIcon />,
                    message: "You’re aren’t allowed to make changes to a filtered collection",
                };
            }
            default:
                throw exhaustive(access);
        }
    });
}
