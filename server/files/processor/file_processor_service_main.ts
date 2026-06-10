import {runService} from "~/server/node/run_service.js";

runService({
    serviceName: "FileProcessorService",
    honeycombDataset: "tracer",
    import: () => import("~/server/files/processor/file_processor_service.js"),

    // Disable clustering for `FileProcessorService`. We don't do CPU intensive work in
    // this service's JavaScript thread. Instead the JavaScript thread is used to
    // schedule work performed by other libraries (e.g. `sharp`, FFmpeg, and
    // LibreOffice). To make reasoning about resource management simpler we disable
    // clustering.
    withoutCluster: true,
});
