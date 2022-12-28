"use strict";

const {parseDotenv} = require("./admin/helpers/parse_dotenv");

const env = parseDotenv();

/** @type {import('@remix-run/dev').AppConfig} */
module.exports = {
    serverBuildTarget: "cloudflare-workers",
    server: "./app/server.ts",
    assetsBuildDirectory: "./app/public/build",
    serverBuildPath: "./app/build/server.js",
    ignoredRouteFiles: ["**/.*"],
    devServerPort: parseInt(env.DEV_SERVER_PORT, 10),
};
