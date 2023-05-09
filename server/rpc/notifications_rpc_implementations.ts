import {
    archiveInboxEntry,
    backfillInboxEntries,
    getInboxChannelPostsEntryPosts,
    getInboxEntries,
    observeInbox,
    unarchiveInboxEntry,
} from "~/server/dynamo/notifications_table";
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

implementRpc(definition.archiveInboxEntry, async (context, input) => {
    await archiveInboxEntry(await context.actor.authenticate(), input);
    return {};
});

implementRpc(definition.unarchiveInboxEntry, async (context, input) => {
    await unarchiveInboxEntry(await context.actor.authenticate(), input);
    return {};
});

implementRpc(definition.observeInbox, async (context, input) => {
    await observeInbox(await context.actor.authenticate(), input);
    return {};
});

implementRpc(definition.getInboxChannelPostsEntryPosts, async (context, input) => {
    return getInboxChannelPostsEntryPosts(await context.actor.authenticate(), input);
});
