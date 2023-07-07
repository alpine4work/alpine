"use strict";

const {parseArgs} = require("util");
const {join: joinPath} = require("path");
const fs = require("fs-extra");
const {Miniflare} = require("miniflare");
const toml = require("toml");

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error("Uncaught exception from edge service:", error);
    process.exitCode = 1;
});

// Log uncaught exceptions, don't kill the process.
process.on("uncaughtException", error => {
    // eslint-disable-next-line no-console
    console.error("Uncaught exception from edge service:", error);
});

async function main() {
    const {
        values: {
            port: portString,
            appPort: appPortString,
            appServicePublicKey: appServicePublicKeyPath,
            edgeServiceFamilyPublicKey: edgeServiceFamilyPublicKeyPath,
            edgeServiceFamilyPrivateKey: edgeServiceFamilyPrivateKeyPath,
            honeycombApiKey,
        },
    } = parseArgs({
        options: {
            port: {type: "string"},
            appPort: {type: "string"},
            appServicePublicKey: {type: "string"},
            edgeServiceFamilyPublicKey: {type: "string"},
            edgeServiceFamilyPrivateKey: {type: "string"},
            honeycombApiKey: {type: "string"},
        },
    });

    if (!portString) throw new Error("Missing `port` arg");
    if (!appPortString) throw new Error("Missing `appPort` arg");
    if (!appServicePublicKeyPath) throw new Error("Missing `appServicePublicKey` arg");
    if (!edgeServiceFamilyPublicKeyPath)
        throw new Error("Missing `edgeServiceFamilyPublicKeyPath` arg");
    if (!edgeServiceFamilyPrivateKeyPath)
        throw new Error("Missing `edgeServiceFamilyPrivateKey` arg");

    const [appServicePublicKey, edgeServiceFamilyPublicKey, edgeServiceFamilyPrivateKey] =
        await Promise.all([
            fs.readFile(appServicePublicKeyPath, "utf8"),
            fs.readFile(edgeServiceFamilyPublicKeyPath, "utf8"),
            fs.readFile(edgeServiceFamilyPrivateKeyPath, "utf8"),
        ]);

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
        bindings: {
            APP_SERVICE_PUBLIC_KEY: appServicePublicKey,
            EDGE_SERVICE_FAMILY_PUBLIC_KEY: edgeServiceFamilyPublicKey,
            EDGE_SERVICE_FAMILY_PRIVATE_KEY: edgeServiceFamilyPrivateKey,
            HONEYCOMB_API_KEY: honeycombApiKey,
        },
    });

    const server = await miniflare.createServer();

    server.listen(port);
}
