import {getAccount, getAccountIfExists} from "~/server/dynamo/accounts_table.js";
import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import * as definition from "~/shared/rpc/accounts_rpc_definitions.js";

implementRpc(
    definition.getAccountIfExists,
    {visibility: ["MyAccountService"]},
    async (context, input) => {
        const account = await getAccountIfExists(context, input.spaceId, input.accountId);
        return {account};
    },
);

implementRpc(
    definition.getAccounts,
    {visibility: ["DocumentCollaborationService"]},
    async (context, input) => {
        const accounts = await runAllPromises(
            Array.from(input.accountIds, accountId =>
                getAccount(context, input.spaceId, accountId),
            ),
        );
        return {accounts};
    },
);
