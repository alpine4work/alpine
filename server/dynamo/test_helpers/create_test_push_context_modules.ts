import {TestApnsContextModule} from "~/server/context/apns_context_module_base.js";
import {TestWebPushContextModule} from "~/server/context/web_push_context_module.js";

export function createTestPushContextModules() {
    return {
        apns: new TestApnsContextModule(),
        webPush: new TestWebPushContextModule(),
    };
}
