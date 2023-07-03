/// <reference types="@remix-run/dev" />

// Remix expects exactly this import path but with Node.js ESM resolution the
// correct convention is to start using the `.js` extension.
declare module "@remix-run/dev/server-build" {
    // eslint-disable-next-line only-erasable-types
    export * from "@remix-run/dev/server-build.js";
}
