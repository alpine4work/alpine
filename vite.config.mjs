import {vitePlugin as remix} from "@remix-run/dev";
import fs from "fs";
import {join as joinPath} from "path";
import {fileURLToPath} from "url";
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

    const directoryPath = fileURLToPath(new URL(".", import.meta.url));

    // TODO(calebmer): Maybe someday Bazel should actually parse the `.js` files to
    // figure out `app/app_client_node_modules.json`. That would eliminate the need
    // for all the exceptions we have.
    const optimizeDepsInclude = JSON.parse(
        fs.readFileSync(joinPath(directoryPath, "app/app_client_node_modules.json"), "utf8"),
    ).flatMap(name => {
        // Packages that only contain types shouldn't be optimized since they won't be
        // used at runtime.
        if (name === "@react-types/shared" || name.startsWith("@types/")) {
            return [];
        }

        if (name === "react-router-dom") {
            return [
                name,
                // We also import `react-router-dom/server.js` so bundle that.
                "react-router-dom/server.js",
            ];
        }

        if (name === "date-fns") {
            return [
                name,
                // Make sure to bundle all the individual `date-fns` files we import.
                "date-fns/addSeconds/index.js",
                "date-fns/compareAsc/index.js",
                "date-fns/differenceInDays/index.js",
                "date-fns/differenceInHours/index.js",
                "date-fns/differenceInMinutes/index.js",
                "date-fns/differenceInMonths/index.js",
                "date-fns/differenceInWeeks/index.js",
                "date-fns/differenceInYears/index.js",
                "date-fns/isEqual/index.js",
                "date-fns/isValid/index.js",
                "date-fns/parseISO/index.js",
                "date-fns/roundToNearestMinutes/index.js",
                "date-fns/startOfWeek/index.js",
            ];
        }

        // Instead of bundling `@codemirror/legacy-modes`, only bundle the individual
        // modes for the languages we support in `content_code_block_language.ts`.
        if (name === "@codemirror/legacy-modes") {
            return [
                "@codemirror/legacy-modes/mode/clike",
                "@codemirror/legacy-modes/mode/powershell",
                "@codemirror/legacy-modes/mode/ruby",
                "@codemirror/legacy-modes/mode/lua",
                "@codemirror/legacy-modes/mode/swift",
                "@codemirror/legacy-modes/mode/gas",
                "@codemirror/legacy-modes/mode/r",
                "@codemirror/legacy-modes/mode/perl",
                "@codemirror/legacy-modes/mode/haskell",
                "@codemirror/legacy-modes/mode/erlang",
                "@codemirror/legacy-modes/mode/mllike",
            ];
        }

        if (name === "html-tags") {
            return [name, "html-tags/void.js"];
        }

        return [name];
    });

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
        // Disable transpiling with `esbuild`. The files Vite serves to the browser are
        // `.js` files that have already been compiled by Bazel and SWC.
        esbuild: false,
        // Explicitly list dependencies for Vite to optimize. We disable Vite's crawl
        // looking for dependencies since we can precisely know dependencies ahead of
        // time with Bazel.
        optimizeDeps: {
            noDiscovery: true,
            entries: [],
            include: optimizeDepsInclude,
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
