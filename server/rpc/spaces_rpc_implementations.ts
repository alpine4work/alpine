import {expensivelyGetAllSpaceAccounts} from "~/server/dynamo/spaces_table.js";
import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import * as definition from "~/shared/rpc/spaces_rpc_definitions.js";

implementRpc(definition.expensivelyGetAllSpaceAccounts, async (context, input) => {
    const accounts = await expensivelyGetAllSpaceAccounts(
        await context.actor.authenticate(),
        input.spaceId,
    );
    return {accounts};
});
