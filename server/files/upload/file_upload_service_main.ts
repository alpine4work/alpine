import {runService} from "~/server/node/run_service.js";

runService({
    serviceName: "FileUploadService",
    import: () => import("~/server/files/upload/file_upload_service_wrapper.js"),
});
