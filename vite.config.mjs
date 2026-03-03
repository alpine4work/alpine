import {vitePlugin as remix} from "@remix-run/dev";
import {defineConfig} from "vite";

export default defineConfig(({mode}) => {
    // Make sure `NODE_ENV` matches `mode`. By default they're different:
    // https://vitejs.dev/guide/env-and-mode.html#node-env-and-modes
    if (process.env.NODE_ENV !== mode) {
        throw new Error(
            `\`NODE_ENV\` environment variable (${JSON.stringify(
                process.env.NODE_ENV,
            )}) does not equal Vite \`mode\` (${JSON.stringify(mode)})`,
        );
    }

    return {
        publicDir: "./app/static/files",
        resolve: {
            // Only allow Vite to resolve JavaScript files. TypeScript code is transpiled with
            // SWC by Bazel. Vite should not be processing TypeScript code.
            extensions: [".mjs", ".js", ".json"],
            // Dedupe React dependencies like the Remix Vite plugin.
            // https://github.com/remix-run/remix/blob/6f83cf3d11436f6306a5d5f2468ce2cc4fe8e3ea/packages/remix-dev/vite/plugin.ts#L1108-L1115
            dedupe: ["react", "react-dom", "@remix-run/react"],
        },
        build: {
            outDir: "./app/build",
            // Generate sourcemaps but don't inject `//# sourceMappingURL` comments into the
            // bundles. This way browsers and CDN won't try to fetch them. The `.map` files are
            // uploaded as GitHub artifacts during deploy and used by `dev sourcemap` to
            // resolve production stack traces.
            sourcemap: "hidden",
        },
        // Vite will rewrite asset URLs to be prefixed with this value on build. In
        // development, Vite ignores the origin portion of the URL[1] and we override it
        // with an inline config in `app_service_wrapper.ts`. Must have a trailing slash as
        // Vite will not include a leading slash in the pathname! [1]:
        // https://vite.dev/config/shared-options.html#base
        base: process.env.NODE_ENV === "production" ? "https://resources.alpine.inc/" : "/",
        // Disable transpiling with `esbuild`. The files Vite serves to the browser are
        // `.js` files that have already been compiled by Bazel and SWC.
        esbuild: false,
        // Completely disable the Vite dependency optimizer. We build optimized
        // dependencies ourselves with Bazel. Then patch Vite to point to our optimized
        // dependency directory.
        //
        // Make sure we disable both client and server optimizations.
        //
        // We also make sure [`preserveSymlinks` is disabled like `rules_esbuild`][1].
        // Since it breaks node_modules resolution in the pnpm-style symlinked node_modules
        // structure.
        //
        // [1]:
        //     https://github.com/aspect-build/rules_esbuild/blob/49510f4eaaab95a5c637dbdacc9f7bc9c80406fd/esbuild/private/esbuild.bzl#L264
        optimizeDeps: {
            noDiscovery: true,
            entries: [],
            include: [],
            esbuildOptions: {preserveSymlinks: false},
        },
        ssr: {
            optimizeDeps: {
                noDiscovery: true,
                include: [],
                esbuildOptions: {preserveSymlinks: false},
            },
        },
        define: {
            // This is set to an empty string outside of production, mostly for integration
            // tests. In integration tests we serve assets from app service, but we don't know
            // the port ahead of time, so an empty string allows us to fall back to relative
            // urls. We override this for dev in `app_service_wrapper.ts` to the actual service
            // url. Does not have a trailing slash so it can be concatenated with relative
            // urls!
            __RESOURCE_SERVICE_URL__: JSON.stringify(
                process.env.NODE_ENV === "production" ? "https://resources.alpine.inc" : "",
            ),
        },
        plugins: [
            process.env.VITE_CONFIG_WITHOUT_REMIX_PLUGIN !== "true" &&
                remix({
                    future: {
                        v3_fetcherPersist: true,
                        v3_relativeSplatPath: true,
                        v3_throwAbortReason: true,
                    },

                    appDirectory: "./app",
                    buildDirectory: "./app/build",
                    serverBuildFile: "remix_server_build.js",
                    // This property is implemented in our `@remix-run/dev` patch. It's used to include
                    // our `AppService` entry point code in the final bundle alongside Remix code so we
                    // don't import the same module multiple times in production.
                    additionalServerInputPath: "./app/app_service_main.js",

                    // Ignore any TypeScript route files that might be in the build directory. We `.js`
                    // files transpiled by SWC.
                    ignoredRouteFiles: ["**/*.ts", "**/*.tsx"],
                    serverModuleFormat: "esm",
                }),
        ].filter(Boolean),
    };
});
