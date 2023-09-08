import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {TracerEvent} from "~/shared/tracer/tracer_event.js";

const isNode = typeof process !== "undefined" && !!process.versions.node;

const nodeSetupPromise = new Lazy(async () => {
    assert(isNode);

    const [{join: joinPath}, {default: fs}, {default: createEnvPaths}]: [
        typeof import("path"),
        {default: typeof import("fs-extra")},
        typeof import("env-paths"),
    ] = await runAllPromises([
        // These imports are carefully written so they can't be statically analyzed
        // and bundled by esbuild into a Cloudflare Workers bundle. It should only work
        // on Node.js.
        //
        // `cast()` does nothing and directly returns its argument. But static
        // analyzers aren't currently smart enough to know that. They think `cast()`
        // could do anything.
        import("pa" + cast("th")),
        import("fs-" + cast("extra")),
        import("env-" + cast("paths")),
    ]);

    const devEnvPaths = createEnvPaths("cyberworlds-development", {suffix: ""});
    const tracerLogDirectoryPath = joinPath(devEnvPaths.log, "tracer");

    await fs.ensureDir(tracerLogDirectoryPath);

    return {joinPath, fs, tracerLogDirectoryPath};
});

/**
 * Writes a tracer event to a file on the developer's computer. Helpful if they
 * want to debug events locally instead of in Honeycomb.
 *
 * In Node.js we have access to the file system so we write the file. Outside
 * of Node.js (like Cloudflare Workers or the browser) we expect a global
 * function to be provided.
 */
export function writeTracerEventToFileInDev(event: TracerEvent) {
    assert(process.env.NODE_ENV !== "production");

    if (!isNode) {
        const globalWriteTracerEventToFileInDev = (globalThis as any).__writeTracerEventToFileInDev;
        assert(
            globalWriteTracerEventToFileInDev,
            "Expected `__writeTracerEventToFileInDev` global in non-Node.js environments",
        );
        return globalWriteTracerEventToFileInDev(event);
    }

    runPromiseWithoutAwaiting(async () => {
        const {joinPath, fs, tracerLogDirectoryPath} = await nodeSetupPromise.get();

        const date = new Date();
        const dateString =
            date.getUTCFullYear().toString().padStart(4, "0") +
            "-" +
            (date.getUTCMonth() + 1).toString().padStart(2, "0") +
            "-" +
            date.getUTCDate().toString().padStart(2, "0");

        const tracerLogFilePath = joinPath(tracerLogDirectoryPath, `tracer-${dateString}.log`);

        await fs.appendFile(
            tracerLogFilePath,
            JSON.stringify({
                time: event.time,
                data: event.getFlatData(),
            }) + "\n",
        );
    });
}
