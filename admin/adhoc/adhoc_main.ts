/// <reference types="@types/node" />

import "~/server/helpers/node/register_noop_react_refresh.js";

import {InternalError} from "~/shared/error/error.js";

// Make our adhoc process easy to find in process managers so we can hunt down
// runaway scripts. We include "cyberworlds" and "node" so you can grep by
// those strings.
process.title = "adhoc (cyberworlds, node)";

async function main() {
    // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
    // @ts-ignore: If there's no `adhoc_local.js` file (e.g. in CI) don't error.
    let adhocModule: typeof import("./adhoc_local.js");

    try {
        // eslint-disable-next-line @typescript-eslint/prefer-ts-expect-error
        // @ts-ignore: If there's no `adhoc_local.js` file (e.g. in CI) don't error.
        adhocModule = await import("./adhoc_local.js");
    } catch (error) {
        throw InternalError.from(error, "Could not import `adhoc_local.ts` file");
    }

    const {run} = adhocModule;

    if (typeof run !== "function")
        throw new InternalError("Could not find `run()` function in `adhoc_local.ts` file");

    await run();
}

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});
