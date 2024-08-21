import {runService} from "~/server/node/run_service.js";

runService({
    serviceName: "DeployService",
    withoutCluster: true,
    import: () => import("~/server/deploy/script/deploy_service_worker.js"),
});
