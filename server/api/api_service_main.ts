import {runService} from "~/server/node/run_service.js";

runService({
    serviceName: "ApiService",
    honeycombDataset: "tracer",
    import: () => import("~/server/api/api_service.js"),
});
