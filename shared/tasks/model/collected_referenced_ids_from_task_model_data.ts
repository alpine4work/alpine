import {unknownAccountId} from "~/shared/accounts/account_model_without_space.js";
import {AccountId, SiteId} from "~/shared/id/types/id_types.js";
import {TaskModelData} from "~/shared/tasks/model/task_model.js";

/**
 * Get all the `AccountId`s and `SiteId`s referenced by a task model.
 *
 * `prepareTaskForClient()` will replace accounts and sites we're not allowed to
 * see with `unknownAccountId` and `unknownSiteId`. So we skip over any accounts or
 * sites with an unknown `AccountId` or `SiteId` in this function.
 */
export function collectReferencedIdsFromTaskModelData(
    accountIds: Set<AccountId>,
    siteIds: Set<SiteId>,
    task: TaskModelData,
) {
    if (task.creator.accountId !== unknownAccountId) {
        accountIds.add(task.creator.accountId);
    }

    if (
        task.status.value.type === "Closed" &&
        task.status.value.closer.accountId !== unknownAccountId
    ) {
        accountIds.add(task.status.value.closer.accountId);
    }

    if (task.assignee.value) {
        if (task.assignee.value.assignee.accountId !== unknownAccountId)
            accountIds.add(task.assignee.value.assignee.accountId);
        if (task.assignee.value.assigner.accountId !== unknownAccountId)
            accountIds.add(task.assignee.value.assigner.accountId);
    }

    if (task.accessPolicy?.value.type === "Site") {
        siteIds.add(task.accessPolicy.value.siteId);
    }
}
