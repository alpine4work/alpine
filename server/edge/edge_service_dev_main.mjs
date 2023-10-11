import fs from "fs-extra";
import inspector from "inspector";
import {Miniflare} from "miniflare";
import {join as joinPath} from "path";
import toml from "toml";
import {parseArgs} from "util";
// eslint-disable-next-line sort-imports-by-source
import {writeTracerEventToFileInDev} from "../../shared/tracer/dev/write_tracer_event_to_file_in_dev.js";

// Make our service easy to find in process managers. We include
// "cyberworlds" and "node" so you can grep by those strings.
process.title = "EdgeServiceFamily dev (cyberworlds, node)";

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});

// Log uncaught exceptions, don't kill the process.
process.on("uncaughtException", error => {
    // eslint-disable-next-line no-console
    console.error(error);
});

async function main() {
    const {
        values: {
            port: portString,
            appServiceUrl,
            appServicePublicKey: appServicePublicKeyPath,
            edgeServiceFamilyPublicKey: edgeServiceFamilyPublicKeyPath,
            taskRealtimeServicePublicKey: taskRealtimeServicePublicKeyPath,
            edgeServiceFamilyPrivateKey: edgeServiceFamilyPrivateKeyPath,
            honeycombApiKey,
            inspectorPort: inspectorPortString,
        },
    } = parseArgs({
        options: {
            port: {type: "string"},
            appServiceUrl: {type: "string"},
            appServicePublicKey: {type: "string"},
            edgeServiceFamilyPublicKey: {type: "string"},
            taskRealtimeServicePublicKey: {type: "string"},
            edgeServiceFamilyPrivateKey: {type: "string"},
            honeycombApiKey: {type: "string"},
            inspectorPort: {type: "string"},
        },
    });

    if (inspectorPortString) {
        inspector.open(parseInt(inspectorPortString, 10));
    }

    if (!portString) throw new Error("Missing `port` arg");
    if (!appServiceUrl) throw new Error("Missing `appServiceUrl` arg");
    if (!appServicePublicKeyPath) throw new Error("Missing `appServicePublicKey` arg");
    if (!edgeServiceFamilyPublicKeyPath)
        throw new Error("Missing `edgeServiceFamilyPublicKeyPath` arg");
    if (!taskRealtimeServicePublicKeyPath)
        throw new Error("Missing `taskRealtimeServicePublicKeyPath` arg");
    if (!edgeServiceFamilyPrivateKeyPath)
        throw new Error("Missing `edgeServiceFamilyPrivateKey` arg");

    const [
        appServicePublicKey,
        edgeServiceFamilyPublicKey,
        taskRealtimeServicePublicKey,
        edgeServiceFamilyPrivateKey,
    ] = await Promise.all([
        fs.readFile(appServicePublicKeyPath, "utf8"),
        fs.readFile(edgeServiceFamilyPublicKeyPath, "utf8"),
        fs.readFile(taskRealtimeServicePublicKeyPath, "utf8"),
        fs.readFile(edgeServiceFamilyPrivateKeyPath, "utf8"),
    ]);

    const port = parseInt(portString, 10);

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
        upstream: appServiceUrl,
        bindings: {
            APP_SERVICE_PUBLIC_KEY: appServicePublicKey,
            EDGE_SERVICE_FAMILY_PUBLIC_KEY: edgeServiceFamilyPublicKey,
            TASK_REALTIME_SERVICE_PUBLIC_KEY: taskRealtimeServicePublicKey,
            EDGE_SERVICE_FAMILY_PRIVATE_KEY: edgeServiceFamilyPrivateKey,
            HONEYCOMB_API_KEY: honeycombApiKey,
        },
        globals: {
            __writeTracerEventToFileInDev: writeTracerEventToFileInDev,
        },
    });

    const server = await miniflare.createServer();

    server.listen(port);
}
