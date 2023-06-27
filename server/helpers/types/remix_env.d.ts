/// <reference types="@remix-run/dev" />
/// <reference types="@remix-run/cloudflare" />
/// <reference types="@cloudflare/workers-types" />

// See: https://github.com/cloudflare/wrangler/pull/2126
declare module "__STATIC_CONTENT_MANIFEST" {
    declare const manifestJson: string;
    // eslint-disable-next-line only-erasable-types, import/no-default-export
    export default manifestJson;
}

// Remix expects exactly this import path but with Node.js ESM resolution the
// correct convention is to start using the `.js` extension.
declare module "@remix-run/dev/server-build" {
    // eslint-disable-next-line only-erasable-types
    export * from "@remix-run/dev/server-build.js";
}
