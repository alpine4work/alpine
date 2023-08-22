import {NotificationsContextModuleBase} from "~/server/notifications/core/notifications_context_module_base.js";
import {ContextModuleBase} from "~/shared/context/context_module_base.js";

export class NoopNotificationsContextModule
    extends ContextModuleBase
    implements NotificationsContextModuleBase
{
    public sendNotificationEvent() {
        // Ignore notification events in tests...
    }

    public async sendInboxRealtimeEventTransaction() {
        // Ignore realtime events in tests...
    }

    public fork() {
        return new NoopNotificationsContextModule();
    }
}
