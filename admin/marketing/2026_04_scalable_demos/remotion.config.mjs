import {Config} from "@remotion/cli/config";
import fs from "fs";
import {join as joinPath} from "path";
import webpack from "webpack";

const workspacePath = process.cwd();

if (!fs.existsSync(joinPath(workspacePath, "WORKSPACE"))) {
    throw new Error("Must run Remotion Studio from the root of the `cyberworlds` repository");
}

if (!process.env.REMOTION_PUBLIC_PORT) {
    throw new Error("Missing `REMOTION_PUBLIC_PORT` environment variable");
}

if (!process.env.REACTION_ICON_SVGS_PATH) {
    throw new Error("Missing `REACTION_ICON_SVGS_PATH` environment variable");
}

// Automatic browser opening doesn't open well when you have multiple browsers
// open. Or if you want to keep looking at the terminal.
Config.setShouldOpenBrowser(false);

Config.overrideWebpackConfig(config => {
    return {
        ...config,
        resolve: {
            ...config.resolve,
            alias: {
                ...config.resolve?.alias,

                // `reaction_icon_svgs.js` is a generated file built by Bazel that doesn't actually
                // exist in our source tree. In order for Remotion Studio to find it (since
                // Remotion Studio works with code from our source tree, instead of Bazel built
                // `.js` files) we need to point Remotion Studio to the `reaction_icon_svgs.js`
                // file in `bazel-bin`.
                "~/client/web/reactions/icons/reaction_icon_svgs.js$":
                    process.env.REACTION_ICON_SVGS_PATH,

                "~": workspacePath,
            },
            extensionAlias: {
                ...config.resolve?.extensionAlias,
                ".js": [".ts", ".tsx", ".js"],
            },
        },
        plugins: [
            ...(config.plugins ?? []),

            new webpack.EnvironmentPlugin({
                REMOTION_PUBLIC_PORT: process.env.REMOTION_PUBLIC_PORT,
            }),
        ],
    };
});
