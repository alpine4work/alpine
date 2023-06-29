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
    },
    server: "./app/server.js",
    serverBuildPath: "./app/build/server.js",
    assetsBuildDirectory: "./app/public/build",
    ignoredRouteFiles: ["**/.*"],
    devServerPort: env.DEV_SERVER_PORT ? parseInt(env.DEV_SERVER_PORT, 10) : undefined,
    publicPath: "/build/",
    serverConditions: ["worker"],
    serverMainFields: ["browser", "module", "main"],
    serverModuleFormat: "esm",
    serverPlatform: "neutral",
    serverDependenciesToBundle: "all",
    serverMinify: true,
};

// Copy of `admin/helpers/parse_dotenv.ts`. Hard to figure out how to include
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
