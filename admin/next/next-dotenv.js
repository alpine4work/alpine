// Loads environment variables from `.env` files into the process in the same
// way that Next.js and `create-react-app` do it.
//
// https://nextjs.org/docs/basic-features/environment-variables

"use strict";

const path = require("path");
const fs = require("fs-extra");

const defaultEnv = "development";

const env = process.env.NODE_ENV || defaultEnv;

// Make sure `NODE_ENV` is set.
process.env.NODE_ENV = env;

const validEnvs = new Set(["development", "test", "production"]);

if (!validEnvs.has(env)) throw new Error(`Unrecognized environment ${JSON.stringify(env)}`);

// https://github.com/bkeepers/dotenv#what-other-env-files-can-i-use
const dotenvPaths = [
    `.env.${env}.local`,
    env !== "test" ? ".env.local" : null, // Not available in test environments
    `.env.${env}`,
    ".env",
]
    .filter(Boolean)
    .map(dotenvPath => path.resolve(__dirname, "../..", dotenvPath));

for (const dotenvPath of dotenvPaths) {
    if (fs.pathExistsSync(dotenvPath)) {
        require("dotenv-expand").expand(
            require("dotenv").config({
                path: dotenvPath,
            }),
        );
    }
}
