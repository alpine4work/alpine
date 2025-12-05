import {TestApnsContextModule} from "~/server/apns/apns_context_module.js";
import {TestWebPushContextModule} from "~/server/context/web_push_context_module.js";

export function createTestPushContextModules() {
    return {
        apns: new TestApnsContextModule(),
        webPush: new TestWebPushContextModule(),
    };
}
