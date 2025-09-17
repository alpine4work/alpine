import {NotificationsInjection} from "~/server/context/injection_context_module.js";
import {notifyInboxOfTimeZoneChange} from "~/server/notifications/data/notifications_actions.js";

export const notificationsInjection: NotificationsInjection = {
    notifyInboxOfTimeZoneChange,
};
