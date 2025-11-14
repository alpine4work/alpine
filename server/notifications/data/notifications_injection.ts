import {NotificationsInjection} from "~/server/context/injection_context_module.js";
import {archiveInboxChatEntryAfterSetChatMessageReaction} from "~/server/notifications/data/archive_inbox_chat_entry_after_set_chat_message_reaction.js";
import {archiveDocumentCommentThreadEntryAfterSetDocumentCommentReaction} from "~/server/notifications/data/archive_inbox_document_comment_thread_entry_after_set_document_comment_reaction.js";
import {archiveInboxPostCommentsEntryAfterSetPostCommentReaction} from "~/server/notifications/data/archive_inbox_post_comments_entry_after_set_post_comment_reaction.js";
import {archiveInboxTaskEntryAfterSetTaskCommentReaction} from "~/server/notifications/data/archive_inbox_task_entry_after_set_task_comment_reaction.js";
import {notifyInboxOfTimeZoneChange} from "~/server/notifications/data/digest/notify_inbox_of_time_zone_change.js";

export const notificationsInjection: NotificationsInjection = {
    notifyInboxOfTimeZoneChange,
    archiveDocumentCommentThreadEntryAfterSetDocumentCommentReaction,
    archiveInboxChatEntryAfterSetChatMessageReaction,
    archiveInboxPostCommentsEntryAfterSetPostCommentReaction,
    archiveInboxTaskEntryAfterSetTaskCommentReaction,
};
