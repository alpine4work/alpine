import {getInboxEntries} from "~/server/dynamo/notifications_table";
import {implementRpc} from "~/server/rpc/internal/implement_rpc";
import * as definition from "~/shared/rpc/notifications_rpc_definitions";

implementRpc(definition.getInboxEntries, async (context, input) => {
    const entriesResult = await getInboxEntries(await context.actor.authenticate(), input);
    return {entriesResult};
});
