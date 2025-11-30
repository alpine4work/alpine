import {runService} from "~/server/node/run_service.js";

runService({
    serviceName: "FileProcessorService",
    import: () => import("~/server/files/processor/file_processor_local_service.js"),
    withoutCluster: true,
});
