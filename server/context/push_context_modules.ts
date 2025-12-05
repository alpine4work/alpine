import {ApnsContextModuleBase} from "~/server/context/apns_context_module_base.js";
import {WebPushContextModuleBase} from "~/server/context/web_push_context_module.js";

export type PushContextModules = {
    apns: ApnsContextModuleBase;
    webPush: WebPushContextModuleBase;
};
