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
            jobQueueServicePublicKey: jobQueueServicePublicKeyPath,
            fileProcessorServicePublicKey: fileProcessorServicePublicKeyPath,
            apiServicePublicKey: apiServicePublicKeyPath,
            edgeServiceFamilyPrivateKey: edgeServiceFamilyPrivateKeyPath,
            tokenAgentSecret: tokenAgentSecretPath,
            fileProcessorServiceUrl,
            cacheLocalDataPath,
            durableObjectsLocalDataPath,
            cloudflareR2LocalDataPath,
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
            jobQueueServicePublicKey: {type: "string"},
            fileProcessorServicePublicKey: {type: "string"},
            apiServicePublicKey: {type: "string"},
            edgeServiceFamilyPrivateKey: {type: "string"},
            tokenAgentSecret: {type: "string"},
            fileProcessorServiceUrl: {type: "string"},
            cacheLocalDataPath: {type: "string"},
            durableObjectsLocalDataPath: {type: "string"},
            cloudflareR2LocalDataPath: {type: "string"},
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
    if (!jobQueueServicePublicKeyPath) throw new Error("Missing `jobQueueServicePublicKey` arg");
    if (!fileProcessorServicePublicKeyPath)
        throw new Error("Missing `fileProcessorServicePublicKeyPath` arg");
    if (!apiServicePublicKeyPath) throw new Error("Missing `apiServicePublicKeyPath` arg");
    if (!edgeServiceFamilyPrivateKeyPath)
        throw new Error("Missing `edgeServiceFamilyPrivateKey` arg");
    if (!tokenAgentSecretPath) throw new Error("Missing `tokenAgentSecret` arg");
    if (!fileProcessorServiceUrl) throw new Error("Missing `fileProcessorServiceUrl` arg");
    if (!cacheLocalDataPath) throw new Error("Missing `cacheLocalDataPath` arg");
    if (!durableObjectsLocalDataPath)
        throw new Error("Missing `durableObjectsLocalDataPath` option");
    if (!cloudflareR2LocalDataPath) throw new Error("Missing `cloudflareR2LocalDataPath` arg");

    const [
        appServicePublicKey,
        edgeServiceFamilyPublicKey,
        taskRealtimeServicePublicKey,
        jobQueueServicePublicKey,
        fileProcessorServicePublicKey,
        apiServicePublicKey,
        edgeServiceFamilyPrivateKey,
        tokenAgentSecret,
    ] = await Promise.all([
        fs.readFile(appServicePublicKeyPath, "utf8"),
        fs.readFile(edgeServiceFamilyPublicKeyPath, "utf8"),
        fs.readFile(taskRealtimeServicePublicKeyPath, "utf8"),
        fs.readFile(jobQueueServicePublicKeyPath, "utf8"),
        fs.readFile(fileProcessorServicePublicKeyPath, "utf8"),
        fs.readFile(apiServicePublicKeyPath, "utf8"),
        fs.readFile(edgeServiceFamilyPrivateKeyPath, "utf8"),
        fs.readFile(tokenAgentSecretPath, "utf8"),
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
        cachePersist: cacheLocalDataPath,
        durableObjectsPersist: durableObjectsLocalDataPath,
        r2Persist: cloudflareR2LocalDataPath,
        bindings: {
            APP_SERVICE_PUBLIC_KEY: appServicePublicKey,
            EDGE_SERVICE_FAMILY_PUBLIC_KEY: edgeServiceFamilyPublicKey,
            TASK_REALTIME_SERVICE_PUBLIC_KEY: taskRealtimeServicePublicKey,
            JOB_QUEUE_SERVICE_PUBLIC_KEY: jobQueueServicePublicKey,
            FILE_PROCESSOR_SERVICE_PUBLIC_KEY: fileProcessorServicePublicKey,
            API_SERVICE_PUBLIC_KEY: apiServicePublicKey,
            EDGE_SERVICE_FAMILY_PRIVATE_KEY: edgeServiceFamilyPrivateKey,
            TOKEN_AGENT_SECRET: tokenAgentSecret,
            FILE_PROCESSOR_SERVICE_URL: fileProcessorServiceUrl,
            HONEYCOMB_API_KEY: honeycombApiKey,
        },
        globals: {
            __writeTracerEventToFileInDev: writeTracerEventToFileInDev,
        },
    });

    const server = await miniflare.createServer();

    server.listen(port);
}
