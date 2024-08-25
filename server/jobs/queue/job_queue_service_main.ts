import {runService} from "~/server/node/run_service.js";

runService({
    serviceName: "JobQueueService",
    import: () => import("~/server/jobs/queue/job_queue_service_worker.js"),
});
