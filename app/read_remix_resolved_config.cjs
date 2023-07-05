"use strict";

const {readConfig} = require("@remix-run/dev/dist/config");

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});

async function main() {
    const remixRoot = process.cwd();
    const mode = process.env.BAZEL_COMPILATION_MODE === "opt" ? "production" : "development";

    const config = await readConfig(remixRoot, mode);

    let configString = JSON.stringify(config, null, 4);

    if (configString.includes("{{remixRoot}}"))
        throw new Error("Variable replacement string `{{remixRoot}}` already exists");

    // `remixRoot` is based in the sandbox where we read the config. When we use
    // `remixRoot` later in a worker we want to use the actual path we're
    // building from.
    configString = configString.replaceAll(remixRoot, "{{remixRoot}}");

    process.stdout.write(configString);
}
