// Virtual module used by the Remix Vite plugin which represents the server build.
// We'll want to import this directly.
// https://github.com/remix-run/remix/blob/ff06e1656108bc21244e1fd4b33ed53e22b85158/packages/remix-dev/vite/plugin.ts#L288
declare module "virtual:remix/server-build" {
    export * from "@remix-run/dev/server-build.js";
}
