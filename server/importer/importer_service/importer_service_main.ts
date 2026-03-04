import {runService} from "~/server/node/run_service.js";

runService({
    serviceName: "ImporterService",
    honeycombDataset: "tracer",
    import: () => import("~/server/importer/importer_service/importer_service.js"),

    // Disable clustering for `ImporterService`. Each import task runs as its own ECS
    // Fargate task, so there's no need for clustering within a single task.
    withoutCluster: true,
});
