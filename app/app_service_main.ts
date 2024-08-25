import {runService} from "~/server/node/run_service.js";

// When running on the server add noop `react-refresh` globals so we
// don't get any reference errors. Our SWC development config applies the
// `react-refresh` transform.
(globalThis as any).$RefreshReg$ = () => {};
(globalThis as any).$RefreshSig$ = () => (value: unknown) => value;

runService({
    serviceName: "AppService",
    import: () => import("~/app/app_service_worker.js"),
});
