import {runService} from "~/server/node/run_service.js";

runService({
    serviceName: "FileProcessorLocalService",
    import: () =>
        import("~/admin/lambda/local/file_processor_service/file_processor_local_service.js"),
    withoutCluster: true,
});
