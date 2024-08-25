import {runService} from "~/server/node/run_service.js";

runService({
    serviceName: "TaskRealtimeService",
    import: () => import("~/server/tasks/realtime/task_realtime_service.js"),
});
