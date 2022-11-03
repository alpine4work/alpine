"use strict";

/** @type {import('@remix-run/dev').AppConfig} */
module.exports = {
    serverBuildTarget: "cloudflare-pages",
    server: "./app/server.js",
    ignoredRouteFiles: ["**/.*"],
    watchPaths: () => ["./client/**/*", "./server/**/*", "./shared/**/*"],
};
