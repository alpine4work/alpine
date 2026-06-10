import {AccountRegistry} from "~/client/web/accounts/account_registry.js";
import {unknownAccountId} from "~/shared/accounts/account_model_without_space.js";
import {InternalError} from "~/shared/error/error.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {mapIterable} from "~/shared/helpers/iterable/map_iterable.js";
import {AccountId, SiteId} from "~/shared/id/types/id_types.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {collectReferencedIdsFromTaskAction} from "~/shared/tasks/actions/collect_referenced_ids_from_task_action.js";
import {TaskActionMaybeModel} from "~/shared/tasks/actions/task_action_model.js";
import {TaskSortableAccount} from "~/shared/tasks/task_sortable_account.js";

/**
 * Create a function we can pass into `TaskModel.apply()` for getting a
 * `TaskSortableAccount` for every referenced `AccountId` in the provided actions.
 *
 * On the client, we expect every `AccountId` referenced by a `TaskAction` to be in
 * our `AccountRegistry` at the moment this function is called. There are two cases
 * where this typically happens:
 *
 * 1. We are applying actions from the server, in which case the server sends
 *    `referencedAccounts` for all actions.
 *
 * 2. We are applying optimistic actions (that then get saved on the server), in
 *    which case UI code needs to render the selected `AccountModel` which implies
 *    it should be in the store.
 *
 *     UI code does need to be careful about creating and holding onto an
 *     `AccountModel` reference but most of the time it should happen naturally.
 */
export function createGetTaskActionReferencedSortableAccount(
    accountRegistry: AccountRegistry,
    actions: TaskActionMaybeModel | ReadonlyArray<TaskActionMaybeModel>,
): (accountId: AccountId) => TaskSortableAccount {
    const actionReferencedAccountIds = new Set<AccountId>();
    // We don't actually use these here. We need to pass them in to
    // collectReferencedIdsFromTaskAction to make it happy.
    const actionReferencedSiteIds = new Set<SiteId>();

    if (!isReadonlyArray(actions)) {
        collectReferencedIdsFromTaskAction(
            actionReferencedAccountIds,
            actionReferencedSiteIds,
            actions,
        );
    } else {
        for (const action of actions) {
            collectReferencedIdsFromTaskAction(
                actionReferencedAccountIds,
                actionReferencedSiteIds,
                action,
            );
        }
    }

    // This does two things:
    //
    // 1. Validates that all accounts referenced by our actions are in the store
    //    whether we use them or not
    // 2. Creates a map that holds a reference to any account stores we care about so
    //    they won't be garbage collected
    //
    // 2 is why we can't pass an `AccountRegistry` directly into `TaskModel.apply()`.
    // We need to make sure that at task creation time we capture a reference to
    // referenced accounts so then at a later action applied time the referenced
    // accounts aren't garbage collected.
    const actionReferencedAccountStoreById = new Map(
        mapIterable(actionReferencedAccountIds, accountId => {
            const accountStore = accountRegistry.weakGetAccountStoreByIdIfExists(accountId);

            if (!accountStore) {
                throw new InternalError(
                    "Couldn\u2019t find `AccountId` referenced by `TaskAction` in `AccountRegistry`",
                );
            }

            return [accountId, accountStore];
        }),
    );

    return accountId => {
        // If the user doesn't have access to an account (e.g. only actors with space
        // access can know a task's creator) we replace the account with
        // `unknownAccountId`. `unknownAccountId` won't be present in referenced accounts
        // so return a value based on our the unknown account's constant data here.
        //
        // See `prepareTaskForClient()`, `prepareTaskActionForClient()`,
        // `collectReferencedAccountIdsFromTaskModelData()`, and
        // `collectReferencedAccountIdsFromTaskAction()`.
        if (accountId === unknownAccountId) {
            const unknownAccount = AccountModel.getUnknownData();

            return {
                accountId: unknownAccount.id,
                workingAccountName: unknownAccount.name,
                workingAccountNameVersion: unknownAccount.nameVersion,
            };
        }

        const accountData = assertExists(
            actionReferencedAccountStoreById.get(accountId),
            "Can\u2019t get a `TaskSortableAccount` that wasn\u2019t referenced by a `TaskAction`",
        ).getSnapshot();

        return {
            accountId,
            workingAccountName: accountData.name,
            workingAccountNameVersion: accountData.nameVersion,
        };
    };
}
