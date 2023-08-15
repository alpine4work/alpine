import {
    archiveInboxEntry,
    backfillInboxEntries,
    getInbox,
    getInboxChannelPostsEntryPosts,
    getInboxEntries,
    observeInbox,
    unarchiveInboxEntry,
} from "~/server/notifications/data/notifications_table.js";
import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import {authorizeSpaceAccess} from "~/server/spaces/spaces_table.js";
import * as definition from "~/shared/rpc/notifications_rpc_definitions.js";

implementRpc(
    definition.getInboxWithStrongReadConsistency,
    {visibility: ["AppClient"]},
    async (_context, input) => {
        const context = _context.actor.authorizeSession();

        // Minor optimization: Authorize space access with eventual consistency instead
        // of inheriting strong consistency. We cache space authorization per request.
        await authorizeSpaceAccess(context, input.spaceId);

        const inbox = await getInbox(context.dynamo.setDefaultReadConsistency("Strong"), input);
        return {inbox};
    },
);

implementRpc(definition.getInboxEntries, {visibility: ["AppClient"]}, async (context, input) => {
    const entriesResult = await getInboxEntries(context.actor.authorizeSession(), input);
    return {entriesResult};
});

implementRpc(
    definition.backfillInboxEntries,
    {visibility: ["AppClient"]},
    async (context, input) => {
        const backfillEntriesResult = await backfillInboxEntries(
            context.actor.authorizeSession(),
            input,
        );
        return {backfillEntriesResult};
    },
);

implementRpc(definition.archiveInboxEntry, {visibility: ["AppClient"]}, async (context, input) => {
    await archiveInboxEntry(context.actor.authorizeSession(), input);
    return {};
});

implementRpc(
    definition.unarchiveInboxEntry,
    {visibility: ["AppClient"]},
    async (context, input) => {
        await unarchiveInboxEntry(context.actor.authorizeSession(), input);
        return {};
    },
);

implementRpc(definition.observeInbox, {visibility: ["AppClient"]}, async (context, input) => {
    await observeInbox(context.actor.authorizeSession(), input);
    return {};
});

implementRpc(
    definition.getInboxChannelPostsEntryPosts,
    {visibility: ["AppClient"]},
    async (context, input) => {
        return getInboxChannelPostsEntryPosts(context.actor.authorizeSession(), input);
    },
);
