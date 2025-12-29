"use strict";

const {join: joinPath, relative: relativePath} = require("path");
const {defineConfig} = require("drizzle-kit");

if (!process.env.RUNFILES) throw new Error("Missing `RUNFILES` environment variable");

const expectedCwd = joinPath(process.env.BUILD_WORKSPACE_DIRECTORY, "server/agents");

if (relativePath(process.cwd(), expectedCwd) === ".")
    throw new Error(`Expected working directory to be \`${expectedCwd}\``);

module.exports = defineConfig({
    out: "./internal/d1/migrations",
    schema: joinPath(
        process.env.RUNFILES,
        "cyberworlds/server/agents/internal/d1/agent_usage_schema.js",
    ),
    dialect: "sqlite",
    driver: "d1-http",
    casing: "snake_case",
});
