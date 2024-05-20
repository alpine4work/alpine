import {createAlphaSpaceAsAdmin} from "~/server/forum/data/forum_table.js";
import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import {getPossiblyStaleAccountSearchAffinityIds} from "~/server/search/data/table/search_entity_table.js";
import {
    dangerouslyCreateSpaceAccountAsAdmin,
    expensivelyGetAllSpaceAccounts,
} from "~/server/spaces/spaces_table.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import * as definition from "~/shared/rpc/spaces_rpc_definitions.js";

implementRpc(
    definition.expensivelyGetAllSpaceAccounts,
    {visibility: ["AppClient"]},
    async (context, input) => {
        const [accounts, sortedAccountIds] = await runAllPromises([
            expensivelyGetAllSpaceAccounts(context, input.spaceId),

            // We return all accounts sorted in affinity order.
            getPossiblyStaleAccountSearchAffinityIds(
                context.actor.authorizeSession(),
                input.spaceId,
            ),
        ]);

        const sortedIndexByAccountId = new Map<AccountId, number>();
        for (let i = 0; i < sortedAccountIds.length; i++) {
            sortedIndexByAccountId.set(sortedAccountIds[i]!, i);
        }

        const sortedAccounts = [...accounts].sort((account1, account2) => {
            const sortedIndex1 = sortedIndexByAccountId.get(account1.id);
            const sortedIndex2 = sortedIndexByAccountId.get(account2.id);

            if (sortedIndex1 !== undefined && sortedIndex2 !== undefined)
                return sortedIndex1 - sortedIndex2;

            if (sortedIndex1 !== undefined && sortedIndex2 === undefined) return -1;
            if (sortedIndex1 === undefined && sortedIndex2 !== undefined) return 1;

            return account1.initialData.name.localeCompare(account2.initialData.name);
        });

        return {accounts: sortedAccounts};
    },
);

implementRpc(definition.createAlphaSpaceAsAdmin, {visibility: ["AppClient"]}, (context, input) => {
    return createAlphaSpaceAsAdmin(context, input);
});

implementRpc(
    definition.dangerouslyCreateSpaceAccountAsAdmin,
    {visibility: ["AppClient"]},
    async (context, input) => {
        await dangerouslyCreateSpaceAccountAsAdmin(context, input);
        return {};
    },
);
