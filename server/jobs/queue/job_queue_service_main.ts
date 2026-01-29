import {runService} from "~/server/node/run_service.js";

runService({
    serviceName: "JobQueueService",
    honeycombDataset: "tracer",
    import: () => {
        // When running on the server add noop `react-refresh` globals so we
        // don't get any reference errors. Our SWC development config applies the
        // `react-refresh` transform.
        (globalThis as any).$RefreshReg$ = () => {};
        (globalThis as any).$RefreshSig$ = () => (value: unknown) => value;

        return import("~/server/jobs/queue/job_queue_service.js");
    },
});
