"use strict";

/** @type {import('@remix-run/dev').AppConfig} */
module.exports = {
    serverBuildTarget: "cloudflare-pages",
    server: "./server.ts",
    ignoredRouteFiles: ["**/.*"],
    watchPaths: () => ["./client/**/*", "./server/**/*", "./shared/**/*"],
};
