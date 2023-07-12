/// <reference types="@types/node" />

import {InternalError} from "~/shared/error/error.js";

async function main() {
    try {
        await import("./adhoc_local.js");
    } catch (error) {
        throw new InternalError('Could not find "adhoc_local.ts" file');
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
