"use strict";

const {parseArgs} = require("util");
const {join: joinPath} = require("path");
const fs = require("fs");
const {Miniflare} = require("miniflare");
const toml = require("toml");

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error("Uncaught exception from edge service:", error);
});

async function main() {
    const {
        values: {port: portString, appPort: appPortString},
    } = parseArgs({
        options: {
            port: {type: "string"},
            appPort: {type: "string"},
        },
    });

    if (!portString) throw new Error("Missing `port` arg");
    if (!appPortString) throw new Error("Missing `appPort` arg");

    const port = parseInt(portString, 10);
    const appPort = parseInt(appPortString, 10);

    const runfilesPath = process.env.RUNFILES;
    if (!runfilesPath) throw new Error("Missing runfiles env variable");

    const configString = fs.readFileSync(
        joinPath(runfilesPath, "cyberworlds/server/edge/wrangler.toml"),
    );
    const config = toml.parse(configString);

    const miniflare = new Miniflare({
        name: config.name,
        modules: true,
        scriptPath: joinPath(runfilesPath, "cyberworlds/server/edge/edge_service_bundle.js"),
        wranglerConfigPath: joinPath(runfilesPath, "cyberworlds/server/edge/wrangler.toml"),
        upstream: `http://localhost:${appPort}`,
    });

    const server = await miniflare.createServer();

    server.listen(port);
}
