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
process.title = "AgentServiceFamily dev (cyberworlds, node)";

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
            cacheLocalDataPath,
            apiServiceUrl,
            chatGptApiServiceKey: chatGptApiServiceKeyPath,
            honeycombApiKey,
            inspectorPort: inspectorPortString,
        },
    } = parseArgs({
        options: {
            port: {type: "string"},
            cacheLocalDataPath: {type: "string"},
            apiServiceUrl: {type: "string"},
            chatGptApiServiceKey: {type: "string"},
            honeycombApiKey: {type: "string"},
            inspectorPort: {type: "string"},
        },
    });

    if (inspectorPortString) {
        inspector.open(parseInt(inspectorPortString, 10));
    }

    if (!cacheLocalDataPath) throw new Error("Missing `cacheLocalDataPath` option");
    if (!apiServiceUrl) throw new Error("Missing `apiServiceUrl` option");
    if (!chatGptApiServiceKeyPath) throw new Error("Missing `chatGptApiServiceKey` option");

    const chatGptApiServiceKey = (await fs.readFile(chatGptApiServiceKeyPath, "utf8")).trim();

    if (!portString) throw new Error("Missing `port` option");
    const port = parseInt(portString, 10);

    const runfilesPath = process.env.RUNFILES;
    if (!runfilesPath) throw new Error("Missing runfiles env variable");

    const configString = fs.readFileSync(
        joinPath(runfilesPath, "cyberworlds/server/agents/wrangler.toml"),
    );
    const config = toml.parse(configString);

    const miniflare = new Miniflare({
        name: config.name,
        modules: true,
        scriptPath: joinPath(runfilesPath, "cyberworlds/server/agents/agent_service_bundle.js"),
        wranglerConfigPath: joinPath(runfilesPath, "cyberworlds/server/agents/wrangler.toml"),
        cachePersist: cacheLocalDataPath,
        bindings: {
            API_SERVICE_URL: apiServiceUrl,
            CHAT_GPT_API_SERVICE_KEY: chatGptApiServiceKey,
            HONEYCOMB_API_KEY: honeycombApiKey,
        },
        globals: {
            __writeTracerEventToFileInDev: writeTracerEventToFileInDev,
        },
    });

    const server = await miniflare.createServer();

    server.listen(port);
}
