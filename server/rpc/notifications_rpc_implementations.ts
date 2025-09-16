import {
    archiveInboxEntry,
    backfillInboxEntries,
    getInbox,
    getInboxChannelPostsEntryPosts,
    getInboxEntries,
    getInboxEntry,
    observeInbox,
    unarchiveInboxEntry,
} from "~/server/notifications/data/notifications_actions.js";
import {implementRpcs} from "~/server/rpc/internal/implement_rpcs.js";
import * as definitions from "~/shared/rpc/notifications_rpc_definitions.js";

export default implementRpcs(definitions, {
    getInboxWithStrongReadConsistency: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const inbox = await getInbox(context.actor.authorizeSession(), {
                ...input,
                consistency: "Strong",
            });
            return {inbox};
        },
    },

    getInboxEntries: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const entriesResult = await getInboxEntries(context.actor.authorizeSession(), input);
            return {entriesResult};
        },
    },

    getInboxEntryWithStrongReadConsistency: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const entry = await getInboxEntry(context.actor.authorizeSession(), {
                ...input,
                consistency: "Strong",
            });
            return {entry};
        },
    },

    backfillInboxEntries: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const backfillEntriesResult = await backfillInboxEntries(
                context.actor.authorizeSession(),
                input,
            );
            return {backfillEntriesResult};
        },
    },

    archiveInboxEntry: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await archiveInboxEntry(context.actor.authorizeSession(), input);
            return {};
        },
    },

    unarchiveInboxEntry: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await unarchiveInboxEntry(context.actor.authorizeSession(), input);
            return {};
        },
    },

    observeInbox: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await observeInbox(context.actor.authorizeSession(), input);
            return {};
        },
    },

    getInboxChannelPostsEntryPosts: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            return getInboxChannelPostsEntryPosts(context.actor.authorizeSession(), input);
        },
    },
});
