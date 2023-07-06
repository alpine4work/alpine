"use strict";

const path = require("path");
const fs = require("fs-extra");
const dotenv = require("dotenv");

const env = parseDotenv();

/** @type {import('@remix-run/dev').AppConfig} */
module.exports = {
    future: {
        v2_routeConvention: true,
        v2_errorBoundary: true,
        v2_normalizeFormMethod: true,
        v2_meta: true,
        v2_headers: true,
        // NOTE(calebmer): We intentionally don't turn on v2 dev with HMR support since
        // it enables expensive transforms. Also after looking at the Remix HMR
        // implementation it doesn't look complete? Individual modules are not reloaded
        // only route modules. It also doesn't add performance benefits since Remix
        // still needs to bundle everything.
        //
        // To get the best development performance I think we'll need to switch out the
        // Remix compiler for Vite.
        v2_dev: false,
    },
    appDirectory: "./app",
    assetsBuildDirectory: "./app/public/build",
    server: "./app/server.js",
    serverBuildPath: "./app/build/server.js",
    serverMainFields: ["module", "main"],
    serverModuleFormat: "esm",
    serverPlatform: "node",
    devServerPort: env.REMIX_DEV_SERVER_PORT ? parseInt(env.REMIX_DEV_SERVER_PORT, 10) : undefined,
    ignoredRouteFiles: ["**/.*"],
};

// Copy of `admin/helpers/parse_dotenv.ts`. Hard to figure out how to import
// other files in this one.
function parseDotenv() {
    const nodeEnv = process.env.NODE_ENV ?? "development";
    if (!nodeEnv) throw new Error("Missing `NODE_ENV` environment variable");

    const files = [
        loadDotenvFile(path.join(__dirname, ".env")),
        loadDotenvFile(path.join(__dirname, `.env.${nodeEnv}`)),
        loadDotenvFile(path.join(__dirname, `.env.${nodeEnv}.local`)),
    ];

    return Object.assign({}, ...files);
}

function loadDotenvFile(filePath) {
    if (!fs.pathExistsSync(filePath)) return {};

    const file = fs.readFileSync(filePath, "utf8");
    return dotenv.parse(file);
}
