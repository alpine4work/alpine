"use strict";

const path = require("path");
const fs = require("fs-extra");
const dotenv = require("dotenv");

const env = parseDotenv();

/** @type {import('@remix-run/dev').AppConfig} */
module.exports = {
    serverBuildTarget: "cloudflare-workers",
    server: "./app/server.ts",
    assetsBuildDirectory: "./app/public/build",
    serverBuildPath: "./app/build/server.js",
    ignoredRouteFiles: ["**/.*"],
    devServerPort: env.DEV_SERVER_PORT ? parseInt(env.DEV_SERVER_PORT, 10) : undefined,
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
