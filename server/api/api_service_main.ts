import {runService} from "~/server/node/run_service.js";

runService({
    serviceName: "ApiService",
    import: () => import("~/server/api/api_service.js"),
});
