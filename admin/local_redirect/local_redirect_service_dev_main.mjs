import fs from "fs-extra";
import inspector from "inspector";
import {Miniflare} from "miniflare";
import {join as joinPath} from "path";
import toml from "toml";
import {parseArgs} from "util";
// eslint-disable-next-line cyberworlds/sort-imports-by-source
import {writeTracerEventToFileInDev} from "../../shared/tracer/dev/write_tracer_event_to_file_in_dev.js";

// Make our service easy to find in process managers. We include "cyberworlds" and
// "node" so you can grep by those strings.
process.title = "LocalRedirectService dev (cyberworlds, node)";

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
            honeycombApiKey,
            inspectorPort: inspectorPortString,
        },
    } = parseArgs({
        options: {
            port: {type: "string"},
            cacheLocalDataPath: {type: "string"},
            honeycombApiKey: {type: "string"},
            inspectorPort: {type: "string"},
        },
    });

    if (inspectorPortString) {
        inspector.open(parseInt(inspectorPortString, 10));
    }

    if (!portString) throw new Error("Missing `port` arg");

    const port = parseInt(portString, 10);

    const runfilesPath = process.env.RUNFILES;
    if (!runfilesPath) throw new Error("Missing runfiles env variable");

    const configString = fs.readFileSync(
        joinPath(runfilesPath, "cyberworlds/admin/local_redirect/wrangler.toml"),
    );
    const config = toml.parse(configString);

    const miniflare = new Miniflare({
        name: config.name,
        modules: true,
        scriptPath: joinPath(
            runfilesPath,
            "cyberworlds/admin/local_redirect/local_redirect_service_bundle.js",
        ),
        wranglerConfigPath: joinPath(
            runfilesPath,
            "cyberworlds/admin/local_redirect/wrangler.toml",
        ),
        cachePersist: cacheLocalDataPath,
        bindings: {
            ALLOWABLE_DESTINATION_ORIGINS: ["http://localhost"],
            HONEYCOMB_API_KEY: honeycombApiKey,
        },
        globals: {
            __writeTracerEventToFileInDev: writeTracerEventToFileInDev,
        },
    });

    const server = await miniflare.createServer();

    server.listen(port);
}
