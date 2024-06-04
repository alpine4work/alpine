import {
    archiveInboxEntry,
    backfillInboxEntries,
    getInbox,
    getInboxChannelPostsEntryPosts,
    getInboxEntries,
    getInboxEntry,
    observeInbox,
    unarchiveInboxEntry,
} from "~/server/notifications/data/notifications_table.js";
import {implementRpc} from "~/server/rpc/internal/implement_rpc.js";
import * as definition from "~/shared/rpc/notifications_rpc_definitions.js";

implementRpc(
    definition.getInboxWithStrongReadConsistency,
    {visibility: ["AppClient"]},
    async (context, input) => {
        const inbox = await getInbox(context.actor.authorizeSession(), {
            ...input,
            consistency: "Strong",
        });
        return {inbox};
    },
);

implementRpc(definition.getInboxEntries, {visibility: ["AppClient"]}, async (context, input) => {
    const entriesResult = await getInboxEntries(context.actor.authorizeSession(), input);
    return {entriesResult};
});

implementRpc(
    definition.getInboxEntryWithStrongReadConsistency,
    {visibility: ["AppClient"]},
    async (context, input) => {
        const entry = await getInboxEntry(context.actor.authorizeSession(), {
            ...input,
            consistency: "Strong",
        });

        return {entry};
    },
);

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
