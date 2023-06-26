import {getAccount} from "~/server/dynamo/accounts_table";
import {ActionContext} from "~/server/dynamo/context/action_context";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {AccountId, SpaceId} from "~/shared/id/types/id_types";
import {TaskQueryFilter} from "~/shared/tasks/task_query_filter";
import {TaskQueryFilterReferences} from "~/shared/tasks/task_query_filter_references";

/**
 * Load all the data referenced in our task query filters.
 */
export async function getTaskQueryFilterReferences(
    context: ActionContext,
    spaceId: SpaceId,
    filters: ReadonlyArray<TaskQueryFilter>,
): Promise<TaskQueryFilterReferences> {
    const accountIds = new Set<AccountId>();

    for (const filter of filters) {
        switch (filter.type) {
            case "Status":
            case "Collections":
            case "Priority":
            case "DueDate":
            case "CreatedDate":
            case "AssignedDate":
            case "ClosedDate":
            case "ActivatedDate": {
                // No references...
                break;
            }
            case "Assignee":
            case "Creator":
            case "Assigner": {
                for (const account of filter.operation.accounts) {
                    switch (account.type) {
                        case "CurrentAccount":
                        case "NoAccount": {
                            // No references...
                            break;
                        }
                        case "Account": {
                            accountIds.add(account.accountId);
                            break;
                        }
                        default:
                            throw exhaustive(account);
                    }
                }
                break;
            }
            default:
                throw exhaustive(filter);
        }
    }

    const accounts = await runAllPromises(
        Array.from(accountIds, accountId => getAccount(context, spaceId, accountId)),
    );

    return {
        accountById: new Map(accounts.map(account => [account.id, account])),
    };
}
