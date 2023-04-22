import {expensivelyGetAllSpaceAccounts} from "~/server/dynamo/spaces_table";
import {implementRpc} from "~/server/rpc/internal/implement_rpc";
import * as definition from "~/shared/rpc/spaces_rpc_definitions";

implementRpc(definition.expensivelyGetAllSpaceAccounts, async (context, input) => {
    const accounts = await expensivelyGetAllSpaceAccounts(
        await context.actor.authenticate(),
        input.spaceId,
    );
    return {accounts};
});
