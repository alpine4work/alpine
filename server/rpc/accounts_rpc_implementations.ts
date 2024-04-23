import {
    getAccountByEmailAddressAsAdmin,
    getAccountByIdAsAdmin,
} from "~/server/accounts/accounts_table.js";
import {updateSessionActorAccountName} from "~/server/accounts/update_name/update_session_actor_account_name.js";
import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import {getAccount} from "~/server/spaces/spaces_table.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import * as definition from "~/shared/rpc/accounts_rpc_definitions.js";

implementRpc(definition.getAccount, {visibility: "Public"}, async (context, input) => {
    const account = await getAccount(context, input.spaceId, input.accountId);
    return {account};
});

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

implementRpc(
    definition.updateSessionActorAccountName,
    {visibility: ["AppClient"]},
    async (context, input) => {
        const account = await updateSessionActorAccountName(
            context.actor.authorizeSession(),
            input.name,
        );

        return {account};
    },
);

implementRpc(
    definition.getAccountByIdAsAdmin,
    {visibility: ["AppClient"]},
    async (context, input) => {
        const account = await getAccountByIdAsAdmin(
            context.actor.authorizeSession(),
            input.accountId,
        );

        return {account};
    },
);

implementRpc(
    definition.getAccountByEmailAddressAsAdmin,
    {visibility: ["AppClient"]},
    async (context, input) => {
        const account = await getAccountByEmailAddressAsAdmin(
            context.actor.authorizeSession(),
            input.emailAddress,
        );

        return {account};
    },
);
