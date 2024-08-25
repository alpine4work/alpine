import {vitePlugin as remix} from "@remix-run/dev";
import {defineConfig} from "vite";

export default defineConfig(({mode}) => {
    // Make sure `NODE_ENV` matches `mode`. By default they're different:
    // https://vitejs.dev/guide/env-and-mode.html#node-env-and-modes
    if (process.env.NODE_ENV !== mode) {
        throw new Error(
            `"NODE_ENV" environment variable (${JSON.stringify(
                process.env.NODE_ENV,
            )}) does not equal Vite "mode" (${JSON.stringify(mode)})`,
        );
    }

    return {
        publicDir: "./app/static/files",
        resolve: {
            // Only allow Vite to resolve JavaScript files. TypeScript code is transpiled
            // with SWC by Bazel. Vite should not be processing TypeScript code.
            extensions: [".mjs", ".js", ".json"],
        },
        build: {
            outDir: "./app/build",
        },
        optimizeDeps: {
            // Don't crawl looking for `.html` files. There are no `.html` files.
            entries: [],
        },
        plugins: [
            remix({
                future: {
                    v3_fetcherPersist: true,
                    v3_relativeSplatPath: true,
                    v3_throwAbortReason: true,
                },

                appDirectory: "./app",
                buildDirectory: "./app/build",
                serverBuildFile: "remix_server_build.js",
                // This property is implemented in our `@remix-run/dev` patch. It's used to
                // include our `AppService` entry point code in the final bundle alongside
                // Remix code so we don't import the same module multiple times in production.
                additionalServerInputPath: "./app/app_service_main.js",

                // Ignore any TypeScript route files that might be in the build directory. We
                // `.js` files transpiled by SWC.
                ignoredRouteFiles: ["**/*.ts", "**/*.tsx"],
                serverModuleFormat: "esm",
            }),
        ],
    };
});
