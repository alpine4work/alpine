/// <reference types="@types/node" />

import {InternalError} from "~/shared/error/error.js";

// Make our adhoc process easy to find in process managers so we can hunt down
// runaway scripts. We include "cyberworlds" and "node" so you can grep by
// those strings.
process.title = "adhoc (cyberworlds, node)";

async function main() {
    try {
        await import("./adhoc_local.js");
    } catch (error) {
        throw InternalError.from(error, 'Could not import "adhoc_local.ts" file');
    }

    const {run} = await import("./adhoc_local.js");

    if (typeof run !== "function")
        throw new InternalError('Could not find `run()` function in "adhoc_local.ts" file');

    await run();
}

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});
