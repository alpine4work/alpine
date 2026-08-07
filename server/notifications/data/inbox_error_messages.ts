import {AccessLevel} from "~/shared/access/access_policy.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {ErrorDisplayMessage} from "~/shared/error/types/error_display_message_type.open_source.js";

/**
 * Access levels that inbox authorization actually accepts. Inbox grants are all or
 * nothing (the owning account has `Manage`, everyone else has none), so we only
 * ever ask for `View` or `Manage` access.
 */
export type InboxExpectedAccessLevel = Extract<AccessLevel, "View" | "Manage">;

export const inboxPermissionDeniedErrorDisplayMessageByAccessLevel: Record<
    InboxExpectedAccessLevel,
    ErrorDisplayMessage
> = {
    View: errorDisplayMessage`You don\u2019t have access to this inbox.`,
    Manage: errorDisplayMessage`You don\u2019t have access to this inbox.`,
};
