"use strict";

const path = require("path");
const fs = require("fs-extra");
const dotenv = require("dotenv");

const env = parseDotenv();

/** @type {import('@remix-run/dev').AppConfig} */
module.exports = {
    future: {
        v2_dev: true,
        v2_routeConvention: true,
        v2_errorBoundary: true,
        v2_normalizeFormMethod: true,
        v2_meta: true,
        v2_headers: true,
    },
    appDirectory: "./app",
    assetsBuildDirectory: "./app/public/build",
    server: "./app/server.js",
    serverBuildPath: "./app/build/server.js",
    serverMainFields: ["module", "main"],
    serverModuleFormat: "esm",
    serverPlatform: "node",
    devServerPort: env.DEV_SERVER_PORT ? parseInt(env.DEV_SERVER_PORT, 10) : undefined,
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
