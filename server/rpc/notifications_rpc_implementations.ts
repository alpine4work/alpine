import {archiveInboxChannelPostsEntryPost} from "~/server/notifications/data/archive_inbox_channel_posts_entry_post.js";
import {archiveInboxDocumentNewCommentThreadsEntryCommentThread} from "~/server/notifications/data/archive_inbox_document_new_comment_threads_entry_comment_thread.js";
import {archiveInboxEntry} from "~/server/notifications/data/archive_inbox_entry.js";
import {subscribeToDigestNotificationsEmail} from "~/server/notifications/data/digest/subscribe_to_digest_notifications_email.js";
import {unsubscribeFromDigestNotificationsEmail} from "~/server/notifications/data/digest/unsubscribe_from_digest_notifications_email.js";
import {getInbox} from "~/server/notifications/data/get_inbox.js";
import {
    backfillInboxEntries,
    getInboxEntries,
} from "~/server/notifications/data/get_inbox_entries.js";
import {getInboxEntry} from "~/server/notifications/data/get_inbox_entry.js";
import {observeInbox} from "~/server/notifications/data/observe_inbox.js";
import {deregisterAccountWebPushSubscription} from "~/server/notifications/data/push/deregister_account_web_push_subscription.js";
import {isOptedOutOfWebPushForSpace} from "~/server/notifications/data/push/is_opted_out_of_web_push_for_space.js";
import {optOutOfWebPushForSpace} from "~/server/notifications/data/push/opt_out_of_web_push_for_space.js";
import {registerAccountWebPushSubscription} from "~/server/notifications/data/push/register_account_web_push_subscription.js";
import {registerOurAccountAppleDeviceToken} from "~/server/notifications/data/push/register_our_account_apple_device_token.js";
import {unarchiveInboxChannelPostsEntryPost} from "~/server/notifications/data/unarchive_inbox_channel_posts_entry_post.js";
import {unarchiveInboxDocumentNewCommentThreadsEntryCommentThread} from "~/server/notifications/data/unarchive_inbox_document_new_comment_threads_entry_comment_thread.js";
import {unarchiveInboxEntry} from "~/server/notifications/data/unarchive_inbox_entry.js";
import {unsubscribeFromEmailNotificationWithUrl} from "~/server/notifications/data/unsubscribe_from_email_notification_with_url.js";
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

    archiveInboxChannelPostsEntryPost: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await archiveInboxChannelPostsEntryPost(context.actor.authorizeSession(), input);
            return {};
        },
    },

    unarchiveInboxChannelPostsEntryPost: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await unarchiveInboxChannelPostsEntryPost(context.actor.authorizeSession(), input);
            return {};
        },
    },

    archiveInboxDocumentNewCommentThreadsEntryCommentThread: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await archiveInboxDocumentNewCommentThreadsEntryCommentThread(
                context.actor.authorizeSession(),
                input,
            );
            return {};
        },
    },

    unarchiveInboxDocumentNewCommentThreadsEntryCommentThread: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await unarchiveInboxDocumentNewCommentThreadsEntryCommentThread(
                context.actor.authorizeSession(),
                input,
            );
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

    unsubscribeFromEmailNotificationWithUrl: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await unsubscribeFromEmailNotificationWithUrl(context, input);
            return {};
        },
    },

    unsubscribeFromDigestNotificationsEmail: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await unsubscribeFromDigestNotificationsEmail(context.actor.authorizeSession(), input);
            return {};
        },
    },

    subscribeToDigestNotificationsEmail: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await subscribeToDigestNotificationsEmail(context.actor.authorizeSession(), input);
            return {};
        },
    },
    registerOurAccountAppleDeviceToken: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await registerOurAccountAppleDeviceToken(
                context.actor.authorizeSession(),
                input.deviceToken,
            );

            return {};
        },
    },
    isOptedOutOfWebPushForSpace: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            const optedOut = await isOptedOutOfWebPushForSpace(
                context.actor.authorizeSession(),
                input,
            );
            return {optedOut};
        },
    },
    optOutOfWebPushForSpace: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await optOutOfWebPushForSpace(context.actor.authorizeSession(), input);
            return {};
        },
    },
    registerAccountWebPushSubscription: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await registerAccountWebPushSubscription(context.actor.authorizeSession(), input);
            return {};
        },
    },
    deregisterAccountWebPushSubscription: {
        visibility: ["AppClient"],
        execute: async (context, input) => {
            await deregisterAccountWebPushSubscription(context.actor.authorizeSession(), input);
            return {};
        },
    },
});
