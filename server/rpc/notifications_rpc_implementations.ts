import {
    archiveInboxEntry,
    backfillInboxEntries,
    getInbox,
    getInboxChannelPostsEntryPosts,
    getInboxEntries,
    observeInbox,
    unarchiveInboxEntry,
} from "~/server/dynamo/notifications_table.js";
import {authorizeSpaceAccess} from "~/server/dynamo/spaces_table.js";
import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import * as definition from "~/shared/rpc/notifications_rpc_definitions.js";

implementRpc(definition.getInboxWithStrongReadConsistency, async (_context, input) => {
    const context = await _context.actor.authenticate();

    // Minor optimization: Authorize space access with eventual consistency.
    await authorizeSpaceAccess(context, input.spaceId);

    const inbox = await getInbox(context.dynamo.setDefaultReadConsistency("Strong"), input);
    return {inbox};
});

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
