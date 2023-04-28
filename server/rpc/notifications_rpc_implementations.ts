import {backfillInboxEntries, getInboxEntries} from "~/server/dynamo/notifications_table";
import {implementRpc} from "~/server/rpc/internal/implement_rpc";
import * as definition from "~/shared/rpc/notifications_rpc_definitions";

implementRpc(definition.getInboxEntries, async (context, input) => {
    const entriesResult = await getInboxEntries(await context.actor.authenticate(), input);
    return {entriesResult};
});

implementRpc(definition.backfillInboxEntries, async (context, input) => {
    const backfillEntriesResult = await backfillInboxEntries(
        await context.actor.authenticate(),
        input,
    );
    return {backfillEntriesResult};
});
