import {NotificationsInjection} from "~/server/context/injection_context_module.js";
import {notifyInboxOfTimeZoneChange} from "~/server/notifications/data/digest/notify_inbox_of_time_zone_change.js";

export const notificationsInjection: NotificationsInjection = {
    notifyInboxOfTimeZoneChange,
};
