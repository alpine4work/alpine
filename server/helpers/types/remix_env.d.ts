/// <reference types="@remix-run/dev" />
/// <reference types="@remix-run/cloudflare" />
/// <reference types="@cloudflare/workers-types" />

// See: https://github.com/cloudflare/wrangler/pull/2126
declare module "__STATIC_CONTENT_MANIFEST" {
    declare const manifestJson: string;
    // eslint-disable-next-line only-erasable-types, import/no-default-export
    export default manifestJson;
}
