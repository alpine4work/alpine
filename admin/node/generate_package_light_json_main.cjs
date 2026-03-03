"use strict";

const fs = require("fs");
const path = require("path");

const packageJsonContents = JSON.parse(
    fs.readFileSync(path.join(process.env.RUNFILES, "cyberworlds/package.json"), "utf8"),
);

process.stdout.write(
    JSON.stringify(
        {
            type: packageJsonContents.type,
            private: packageJsonContents.private,
            name: packageJsonContents.name,
            version: packageJsonContents.version,

            // Include our conditional imports since we need them at runtime.
            imports: packageJsonContents.imports,

            // Don't include ever dependency in `package_light.json`. Only the dependencies
            // code at runtime/buildtime need to see. The Remix compiler needs to see the
            // versions for all of these dependencies:
            //
            // https://github.com/remix-run/remix/blob/9bdc908c9d47870dee51b2a8ff6d783bce3c666e/packages/remix-dev/config.ts#L700-L792
            dependencies: Object.fromEntries(
                ["@remix-run/node", "@remix-run/react", "isbot", "react", "react-dom"].map(
                    dependencyName => [
                        dependencyName,
                        packageJsonContents.dependencies[dependencyName],
                    ],
                ),
            ),
        },
        null,
        4,
    ) + "\n",
);
