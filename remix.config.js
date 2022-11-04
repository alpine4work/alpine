"use strict";

/** @type {import('@remix-run/dev').AppConfig} */
module.exports = {
    serverBuildTarget: "cloudflare-workers",
    server: "./app/server.js",
    assetsBuildDirectory: "./app/public/build",
    serverBuildPath: "./app/build/server.js",
    ignoredRouteFiles: ["**/.*"],
    devServerPort: 3001,
};
