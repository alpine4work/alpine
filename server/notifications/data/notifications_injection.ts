import {NotificationsInjection} from "~/server/context/injection_context_module.js";
import {notifyInboxOfTimeZoneChange} from "~/server/notifications/data/notifications_actions_digest.js";

export const notificationsInjection: NotificationsInjection = {
    notifyInboxOfTimeZoneChange,
};
