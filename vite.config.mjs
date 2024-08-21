import {vitePlugin as remix} from "@remix-run/dev";
import {defineConfig} from "vite";

// NOCOMMIT: xxxx

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
        build: {
            outDir: "./app/build",
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
                additionalServerInputPath: "./app/app_service.js",

                ignoredRouteFiles: ["**/.*"],
                serverModuleFormat: "esm",
            }),
        ],
    };
});
