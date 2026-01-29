import {runService} from "~/server/node/run_service.js";

runService({
    serviceName: "MigrationService",
    honeycombDataset: "tracer",
    // TODO(calebmer): We should use Node.js clustering to improve migration
    // performance even more. Each AWS instance could be running 3-5 Node.js
    // threads and each thread itself does parallel processing.
    withoutCluster: true,
    import: () => import("~/server/migration/migration_service.js"),
});
