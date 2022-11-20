import crypto from "crypto";
import {InternalError} from "~/shared/error/error";

// Set the Node.js `webcrypto` implementation to the `crypto` global so that
// client code which runs in a browser has access to the web Crypto API.
(globalThis as any).crypto = crypto.webcrypto;

async function main() {
    try {
        require.resolve("./adhoc_local");
    } catch (error) {
        throw new InternalError('Could not find "adhoc_local.ts" file');
    }

    const {run} = require("./adhoc_local");

    if (typeof run !== "function")
        throw new InternalError('Could not find `run()` function in "adhoc_local.ts" file');

    await run();
}

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});
