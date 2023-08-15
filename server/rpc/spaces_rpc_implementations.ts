import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import {expensivelyGetAllSpaceAccounts} from "~/server/spaces/spaces_table.js";
import * as definition from "~/shared/rpc/spaces_rpc_definitions.js";

implementRpc(
    definition.expensivelyGetAllSpaceAccounts,
    {visibility: ["AppClient"]},
    async (context, input) => {
        const accounts = await expensivelyGetAllSpaceAccounts(context, input.spaceId);
        return {accounts};
    },
);
