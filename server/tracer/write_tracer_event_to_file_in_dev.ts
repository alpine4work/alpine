import createEnvPaths from "env-paths";
import fs from "fs-extra";
import {join as joinPath} from "path";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {assert} from "~/shared/helpers/control/assert.js";

// Can only import this file in Node.js. It won't work in Cloudflare.
assert(process.versions.node);

// TODO(calebmer): This is copied from `admin/helpers/dev_env_paths.ts` which
// isn't great. Using `fs` in a package used by Cloudflare also isn't great. We
// should see if there's a better package structure we can setup for
// Cloudflare/Node.js shared stuff and have a Node.js specific helpers folder.
const devEnvPaths = createEnvPaths("cyberworlds-development", {suffix: ""});

const tracerLogDirectoryPath = joinPath(devEnvPaths.log, "tracer");
fs.ensureDirSync(tracerLogDirectoryPath);

/**
 * Writes a tracer event to a file on the developer's computer. Helpful if they
 * want to debug events locally instead of Honeycomb.
 */
export function writeTracerEventToFileInDev(event: unknown) {
    runPromiseWithoutAwaiting(async () => {
        const date = new Date();
        const dateString =
            date.getUTCFullYear().toString().padStart(4, "0") +
            "-" +
            (date.getUTCMonth() + 1).toString().padStart(2, "0") +
            "-" +
            date.getUTCDate().toString().padStart(2, "0");

        const tracerLogFilePath = joinPath(tracerLogDirectoryPath, `tracer-${dateString}.log`);

        await fs.appendFile(tracerLogFilePath, JSON.stringify(event) + "\n");
    });
}
