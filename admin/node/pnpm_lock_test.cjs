"use strict";

const fs = require("fs-extra");
const {join: joinPath} = require("path");
const Yaml = require("yaml");

const runfilesPath = process.env.RUNFILES;
if (!runfilesPath) throw new Error("Expected `RUNFILES` environment variable to exist");

// Duplicate packages we can't easily get rid of go in this map. Please add a
// comment explaining why there are duplicate packages.
const allowedDuplicatePackageVersionsByName = new Map([
    // Our `wrangler` dependency has an old version of `esbuild` we allow since we
    // should be bundling our code with a newer version of `esbuild` before it gets
    // to `wrangler`.
    ["esbuild", ["0.17.19", "0.21.5"]],
    ["@esbuild/android-arm64", ["0.17.19", "0.21.5"]],
    ["@esbuild/android-arm", ["0.17.19", "0.21.5"]],
    ["@esbuild/android-x64", ["0.17.19", "0.21.5"]],
    ["@esbuild/darwin-arm64", ["0.17.19", "0.21.5"]],
    ["@esbuild/darwin-x64", ["0.17.19", "0.21.5"]],
    ["@esbuild/freebsd-arm64", ["0.17.19", "0.21.5"]],
    ["@esbuild/freebsd-x64", ["0.17.19", "0.21.5"]],
    ["@esbuild/linux-arm64", ["0.17.19", "0.21.5"]],
    ["@esbuild/linux-arm", ["0.17.19", "0.21.5"]],
    ["@esbuild/linux-ia32", ["0.17.19", "0.21.5"]],
    ["@esbuild/linux-loong64", ["0.17.19", "0.21.5"]],
    ["@esbuild/linux-mips64el", ["0.17.19", "0.21.5"]],
    ["@esbuild/linux-ppc64", ["0.17.19", "0.21.5"]],
    ["@esbuild/linux-riscv64", ["0.17.19", "0.21.5"]],
    ["@esbuild/linux-s390x", ["0.17.19", "0.21.5"]],
    ["@esbuild/linux-x64", ["0.17.19", "0.21.5"]],
    ["@esbuild/netbsd-x64", ["0.17.19", "0.21.5"]],
    ["@esbuild/openbsd-x64", ["0.17.19", "0.21.5"]],
    ["@esbuild/sunos-x64", ["0.17.19", "0.21.5"]],
    ["@esbuild/win32-arm64", ["0.17.19", "0.21.5"]],
    ["@esbuild/win32-ia32", ["0.17.19", "0.21.5"]],
    ["@esbuild/win32-x64", ["0.17.19", "0.21.5"]],

    // Incompatible versions from AWS dependencies. Mostly stemming from
    // `@aws-sdk/client-s3`'s dependency on `@aws-crypto/sha1-browser`.
    ["@smithy/is-array-buffer", ["2.2.0", "3.0.0"]],
    ["@smithy/util-buffer-from", ["2.2.0", "3.0.0"]],
    ["@smithy/util-utf8", ["2.3.0", "3.0.0"]],

    // We keep using Miniflare v2 in our development environment since it runs in
    // a Node.js environment instead of a custom JavaScript VM (backed by
    // `workerd`). This makes programs running with Miniflare v2 easier to debug
    // since we can use the usual Node.js debugging processes.
    ["miniflare", ["2.14.4", "3.20241106.0"]],

    // NOTE(calebmer, 2024-08-13): Duplicate packages after adding dependencies
    // for `aws-cdk` to `packageExtensions` that we can't easily resolve but
    // shouldn't cause issues.
    ["agent-base", ["6.0.2", "7.1.3"]],
    ["ajv", ["6.12.6", "8.17.1"]],
    ["https-proxy-agent", ["5.0.1", "7.0.6"]],
    ["json-schema-traverse", ["0.4.1", "1.0.0"]],
    ["mute-stream", ["0.0.8", "1.0.0"]],
    ["socks-proxy-agent", ["6.2.1", "8.0.5"]],
    ["sprintf-js", ["1.0.3", "1.1.3"]],
    ["yaml", ["1.10.2", "2.5.0"]],

    // NOTE(calebmer, 2024-08-26): We started using `whatwg-mimetype` but a
    // dependency has an older major version.
    ["whatwg-mimetype", ["3.0.0", "4.0.0"]],

    // NOTE(calebmer, 2024-08-27): Duplicate packages after adding `looks-same`
    // that we can't easily resolve but shouldn't cause issues.
    ["fs-extra", ["8.1.0", "9.1.0", "11.2.0"]],
    ["jsonfile", ["4.0.0", "6.1.0"]],

    // NOTE(calebmer, 2024-11-15): Duplicate packages after upgrading `miniflare`
    // v3 that we can't easily resolve but shouldn't cause issues.
    ["chokidar", ["3.6.0", "4.0.1"]],
    ["readdirp", ["3.6.0", "4.0.2"]],
    ["@jridgewell/trace-mapping", ["0.3.25", "0.3.9"]],

    // NOTE(calebmer, 2025-04-15): Duplicate packages after upgrading `aws-cdk-lib`
    // (to 2.189.1) and corresponding `@aws-sdk` packages that we can't easily
    // resolve but shouldn't cause issues.
    ["@smithy/is-array-buffer", ["2.2.0", "4.0.0"]],
    ["@smithy/util-buffer-from", ["2.2.0", "4.0.0"]],
    ["@smithy/util-utf8", ["2.3.0", "4.0.0"]],
    ["diff", ["5.2.0", "7.0.0"]],
    ["events", ["1.1.1", "3.3.0"]],
    ["jackspeak", ["2.3.6", "4.1.0"]],
    ["path-scurry", ["1.11.1", "2.0.0"]],
    ["tar-stream", ["2.2.0", "3.1.7"]],

    // NOTE(calebmer, 2025-08-21): Duplicate packages after adding `ajv`,
    // `find-my-way`, `mustache`, `openapi-types`, `openapi-typescript`, and
    // `supertest` for `ApiService`.
    ["parse-json", ["5.2.0", "8.3.0"]],
    ["qs", ["6.11.0", "6.14.0"]],

    // NOTE(calebmer, 2024-08-08): List of packages from when we added this
    // test. We did a quick skim to see if there were any packages we use where
    // duplicate packages could be an issue and we tried to fix some easy
    // duplicates.
    //
    // Any new duplicate packages please try to add a section above with a comment
    // explaining why. npm packages man. Tough time.
    ["@jridgewell/gen-mapping", ["0.1.1", "0.3.5"]],
    ["@npmcli/fs", ["1.1.1", "3.1.1"]],
    ["@tootallnate/once", ["1.1.2", "2.0.0"]],
    ["@types/cookie", ["0.5.1", "0.6.0"]],
    ["@types/mdast", ["3.0.10", "4.0.3"]],
    ["@types/node", ["20.3.2", "22.1.0"]],
    ["@types/unist", ["2.0.6", "3.0.2"]],
    ["@typescript-eslint/scope-manager", ["5.60.1", "7.13.1"]],
    ["@typescript-eslint/types", ["5.60.1", "7.13.1"]],
    ["@typescript-eslint/typescript-estree", ["5.60.1", "7.13.1"]],
    ["@typescript-eslint/utils", ["5.60.1", "7.13.1"]],
    ["@typescript-eslint/visitor-keys", ["5.60.1", "7.13.1"]],
    ["ansi-regex", ["5.0.1", "6.0.1"]],
    ["ansi-styles", ["4.3.0", "5.2.0", "6.2.1"]],
    ["argparse", ["1.0.10", "2.0.1"]],
    ["axe-core", ["4.4.3", "4.7.2"]],
    ["brace-expansion", ["1.1.11", "2.0.1"]],
    ["buffer", ["4.9.2", "5.6.0", "5.7.1", "6.0.3"]],
    ["cacache", ["15.3.0", "17.1.4"]],
    ["camelcase", ["5.3.1", "6.3.0"]],
    ["chalk", ["3.0.0", "4.1.2"]],
    ["chownr", ["1.1.4", "2.0.0"]],
    ["cliui", ["7.0.4", "8.0.1"]],
    ["color-convert", ["0.5.3", "1.9.3", "2.0.1"]],
    ["color-name", ["1.1.3", "1.1.4"]],
    ["color", ["3.2.1", "4.2.3"]],
    ["commander", ["2.20.3", "5.1.0"]],
    ["convert-source-map", ["1.8.0", "2.0.0"]],
    ["cookie-signature", ["1.0.6", "1.2.1"]],
    ["cookie", ["0.4.1", "0.4.2", "0.5.0", "0.6.0"]],
    ["cssom", ["0.3.8", "0.5.0"]],
    ["data-uri-to-buffer", ["2.0.2", "3.0.1", "6.0.2"]],
    ["debug", ["2.6.9", "3.2.7", "4.4.1"]],
    ["dedent", ["0.7.0", "1.5.3"]],
    ["doctrine", ["2.1.0", "3.0.0"]],
    ["domhandler", ["3.3.0", "4.3.1"]],
    ["dotenv", ["10.0.0", "16.0.3"]],
    ["emoji-regex", ["8.0.0", "9.2.2", "10.2.1"]],
    ["entities", ["2.2.0", "4.5.0"]],
    ["escape-string-regexp", ["2.0.0", "4.0.0"]],
    ["eslint-scope", ["5.1.1", "7.2.2"]],
    ["eslint-visitor-keys", ["1.3.0", "2.1.0", "3.4.3"]],
    ["estraverse", ["4.3.0", "5.3.0"]],
    ["estree-util-is-identifier-name", ["1.1.0", "2.0.1"]],
    ["estree-walker", ["0.6.1", "3.0.1"]],
    ["execa", ["5.1.1", "6.1.0"]],
    ["find-up", ["4.1.0", "5.0.0"]],
    ["fs-minipass", ["2.1.0", "3.0.3"]],
    ["fsevents", ["2.3.2", "2.3.3"]],
    ["glob-parent", ["5.1.2", "6.0.2"]],
    ["glob", ["7.2.3", "8.0.3", "10.3.15", "11.0.1"]],
    ["globals", ["11.12.0", "13.24.0"]],
    ["globby", ["11.1.0", "13.1.3"]],
    ["htmlparser2", ["4.1.0", "6.1.0"]],
    ["http-proxy-agent", ["4.0.1", "5.0.0", "7.0.2"]],
    ["human-signals", ["2.1.0", "3.0.1"]],
    ["iconv-lite", ["0.4.24", "0.6.3"]],
    ["ieee754", ["1.1.13", "1.2.1"]],
    ["is-arrayish", ["0.2.1", "0.3.2"]],
    ["is-plain-obj", ["3.0.0", "4.1.0"]],
    ["is-stream", ["2.0.1", "3.0.0"]],
    ["isarray", ["1.0.0", "2.0.5"]],
    ["istanbul-lib-instrument", ["5.2.0", "6.0.0"]],
    ["js-yaml", ["3.14.1", "4.1.0"]],
    ["jsesc", ["2.5.2", "3.0.2"]],
    ["json-parse-even-better-errors", ["2.3.1", "3.0.2"]],
    ["json5", ["1.0.1", "2.2.3"]],
    ["kleur", ["3.0.3", "4.1.5"]],
    ["locate-path", ["5.0.0", "6.0.0"]],
    ["lru-cache", ["4.1.5", "5.1.1", "6.0.0", "7.18.3", "10.2.2", "11.1.0"]],
    ["mdast-util-from-markdown", ["1.2.0", "2.0.0"]],
    ["mdast-util-to-markdown", ["1.3.0", "2.1.0"]],
    ["mdast-util-to-string", ["3.1.0", "4.0.0"]],
    ["micromark-core-commonmark", ["1.0.6", "2.0.0"]],
    ["micromark-factory-destination", ["1.0.0", "2.0.0"]],
    ["micromark-factory-label", ["1.0.2", "2.0.0"]],
    ["micromark-factory-space", ["1.0.0", "2.0.0"]],
    ["micromark-factory-title", ["1.0.2", "2.0.0"]],
    ["micromark-factory-whitespace", ["1.0.0", "2.0.0"]],
    ["micromark-util-character", ["1.1.0", "2.0.1"]],
    ["micromark-util-chunked", ["1.0.0", "2.0.0"]],
    ["micromark-util-classify-character", ["1.0.0", "2.0.0"]],
    ["micromark-util-combine-extensions", ["1.0.0", "2.0.0"]],
    ["micromark-util-decode-numeric-character-reference", ["1.0.0", "2.0.1"]],
    ["micromark-util-decode-string", ["1.0.2", "2.0.0"]],
    ["micromark-util-encode", ["1.0.1", "2.0.0"]],
    ["micromark-util-html-tag-name", ["1.1.0", "2.0.0"]],
    ["micromark-util-normalize-identifier", ["1.0.0", "2.0.0"]],
    ["micromark-util-resolve-all", ["1.0.0", "2.0.0"]],
    ["micromark-util-sanitize-uri", ["1.1.0", "2.0.0"]],
    ["micromark-util-subtokenize", ["1.0.2", "2.0.0"]],
    ["micromark-util-symbol", ["1.0.1", "2.0.0"]],
    ["micromark-util-types", ["1.0.2", "2.0.0"]],
    ["micromark", ["3.1.0", "4.0.0"]],
    ["mime", ["1.6.0", "2.6.0", "3.0.0"]],
    ["mimic-fn", ["2.1.0", "4.0.0"]],
    ["minimatch", ["3.1.2", "5.1.1", "9.0.5", "10.0.1"]],
    ["minipass", ["3.3.4", "7.1.2"]],
    ["ms", ["2.0.0", "2.1.3"]],
    ["nopt", ["5.0.0", "6.0.0"]],
    ["npm-run-path", ["4.0.1", "5.1.0"]],
    ["onetime", ["5.1.2", "6.0.0"]],
    ["p-limit", ["2.3.0", "3.1.0"]],
    ["p-locate", ["4.1.0", "5.0.0"]],
    ["parse5", ["6.0.1", "7.1.2"]],
    ["path-key", ["3.1.1", "4.0.0"]],
    ["path-to-regexp", ["0.1.7", "6.3.0"]],
    ["pretty-format", ["27.5.1", "29.6.3"]],
    ["pump", ["2.0.1", "3.0.0"]],
    ["punycode", ["1.3.2", "2.3.1"]],
    ["react-is", ["16.13.1", "17.0.2", "18.2.0"]],
    ["readable-stream", ["2.3.7", "3.6.0", "4.7.0"]],
    ["regenerator-runtime", ["0.10.5", "0.13.11"]],
    ["resolve-from", ["4.0.0", "5.0.0"]],
    ["resolve", ["1.22.8", "2.0.0-next.5"]],
    ["safe-buffer", ["5.1.2", "5.2.1"]],
    ["scheduler", ["0.20.2", "0.23.0"]],
    ["semver", ["5.7.2", "6.3.1", "7.7.1"]],
    ["signal-exit", ["3.0.7", "4.1.0"]],
    ["slash", ["3.0.0", "4.0.0"]],
    ["source-map-support", ["0.5.13", "0.5.21"]],
    ["source-map", ["0.6.1", "0.7.4"]],
    ["ssri", ["8.0.1", "10.0.6"]],
    ["string-width", ["4.2.3", "5.1.2"]],
    ["string_decoder", ["1.1.1", "1.3.0"]],
    ["strip-ansi", ["6.0.1", "7.1.0"]],
    ["strip-bom", ["3.0.0", "4.0.0"]],
    ["strip-final-newline", ["2.0.0", "3.0.0"]],
    ["supports-color", ["7.2.0", "8.1.1", "10.0.0"]],
    ["tr46", ["0.0.3", "3.0.0"]],
    ["tsconfig-paths", ["3.14.1", "4.1.0"]],
    ["tslib", ["1.14.1", "2.4.0", "2.6.3"]],
    ["type-fest", ["0.20.2", "0.21.3", "4.41.0"]],
    ["type", ["1.2.0", "2.7.2"]],
    ["undici", ["5.28.4", "6.17.0"]],
    ["unique-filename", ["1.1.1", "3.0.0"]],
    ["unique-slug", ["2.0.2", "4.0.0"]],
    ["unist-util-is", ["5.1.1", "6.0.0"]],
    ["unist-util-stringify-position", ["3.0.2", "4.0.0"]],
    ["unist-util-visit-parents", ["5.1.1", "6.0.1"]],
    ["unist-util-visit", ["4.1.1", "5.0.0"]],
    ["universalify", ["0.1.2", "0.2.0", "2.0.0"]],
    ["uuid", ["8.0.0", "8.3.2", "9.0.1", "11.1.0"]],
    ["validate-npm-package-name", ["4.0.0", "5.0.1"]],
    ["webidl-conversions", ["3.0.1", "7.0.0"]],
    ["whatwg-url", ["5.0.0", "11.0.0"]],
    ["which", ["2.0.2", "3.0.1"]],
    ["wrap-ansi", ["6.2.0", "7.0.0", "8.1.0"]],
    ["ws", ["7.5.9", "8.18.0"]],
    ["yallist", ["2.1.2", "3.1.1", "4.0.0"]],
    ["yargs-parser", ["20.2.9", "21.1.1"]],
    ["yargs", ["16.2.0", "17.7.2"]],
    ["youch", ["2.2.2", "3.2.3"]],
]);

async function main() {
    const pnpmLockContents = await fs.readFile(
        joinPath(runfilesPath, "cyberworlds/pnpm-lock.yaml"),
        "utf8",
    );
    const pnpmLock = Yaml.parse(pnpmLockContents);

    const packageVersionsByName = new Map();

    for (const packageKey of Object.keys(pnpmLock.packages)) {
        const match = packageKey.startsWith("file:")
            ? [packageKey, pnpmLock.packages[packageKey].name, packageKey]
            : packageKey.match(
                  /^((?:@[a-z0-9-~][a-z0-9-._~]*\/)?[a-z0-9-~][a-z0-9-._~]*)@(\d+\.\d+\.\d+(?:-[a-z0-9-~][a-z0-9-._~]*)?|file:[^(]*)(?:$|\()/,
              );
        if (!match) {
            throw new Error(`Unexpected package key format: ${JSON.stringify(packageKey)}`);
        }

        const packageName = match[1];
        const packageVersion = match[2];

        if (typeof packageName !== "string" || typeof packageVersion !== "string") {
            throw new Error(
                `Unexpected string package name and version but got name: ${JSON.stringify(
                    packageName,
                )}, version: ${JSON.stringify(packageName)}`,
            );
        }

        let packageVersions = packageVersionsByName.get(packageName);

        if (!packageVersions) {
            packageVersions = [];
            packageVersionsByName.set(packageName, packageVersions);
        }

        packageVersions.push(packageVersion);
    }

    // Defense in case parsing failed and there were no packages in
    // `pnpm-lock.yaml`.
    if (packageVersionsByName.size === 0) {
        throw new Error("Found no packages");
    }

    let unexpectedDuplicatePackageCount = 0;
    let unusedAllowedDuplicatePackageCount = 0;

    const usedAllowedDuplicatePackageNames = new Set();

    for (const [packageName, packageVersions] of packageVersionsByName) {
        if (packageVersions.length === 1) continue;

        packageVersions.sort((a, b) => {
            const aMatch = a.match(/^\d+\.\d+\.\d+/);
            const bMatch = b.match(/^\d+\.\d+\.\d+/);

            if (!aMatch && !bMatch) return defaultCompareStrings(a, b);
            if (!aMatch) return -1;
            if (!bMatch) return 1;

            const a1 = parseInt(aMatch[0], 10);
            const a2 = parseInt(aMatch[1], 10);
            const a3 = parseInt(aMatch[2], 10);

            const b1 = parseInt(bMatch[0], 10);
            const b2 = parseInt(bMatch[1], 10);
            const b3 = parseInt(bMatch[2], 10);

            if (a1 !== b1) return a1 - b1;
            if (a2 !== b2) return a2 - b2;
            if (a3 !== b3) return a3 - b3;

            return defaultCompareStrings(a.slice(aMatch[0].length), b.slice(bMatch[0].length));
        });

        const allowedDuplicatePackageVersions =
            allowedDuplicatePackageVersionsByName.get(packageName);

        if (
            allowedDuplicatePackageVersions &&
            areArraysEqual(allowedDuplicatePackageVersions, packageVersions)
        ) {
            usedAllowedDuplicatePackageNames.add(packageName);
            continue;
        }

        unexpectedDuplicatePackageCount++;

        // eslint-disable-next-line no-console
        console.log(
            `Package \`${packageName}\` has multiple versions: ${packageVersions
                .map(packageVersion => `\`${packageVersion}\``)
                .join(", ")}`,
        );
    }

    for (const packageName of allowedDuplicatePackageVersionsByName.keys()) {
        if (usedAllowedDuplicatePackageNames.has(packageName)) continue;

        unusedAllowedDuplicatePackageCount++;

        // eslint-disable-next-line no-console
        console.log(
            `Matching duplicate versions weren’t found for package \`${packageName}\` that allows duplicate versions`,
        );
    }

    let exitCode = unexpectedDuplicatePackageCount + unusedAllowedDuplicatePackageCount;

    if (allowedDuplicatePackageVersionsByName.has("sharp")) {
        exitCode++;

        // eslint-disable-next-line no-console
        console.log(
            "Should only ever have one version of `sharp`, duplicate versions will cause issues with native module loading",
        );
    }

    if (unexpectedDuplicatePackageCount > 0) {
        // eslint-disable-next-line no-console
        console.log("");
        // eslint-disable-next-line no-console
        console.log(
            "Hint: Try running `pnpm dedupe` and `pnpm prune` to remove older dependencies if",
        );
        // eslint-disable-next-line no-console
        console.log(
            "a newer version can be used. If you can’t easily remove duplicates then you may",
        );
        // eslint-disable-next-line no-console
        console.log(
            "add allowed duplicate package versions to `allowedDuplicatePackageVersionsByName`.",
        );
    }

    if (unusedAllowedDuplicatePackageCount > 0) {
        // eslint-disable-next-line no-console
        console.log("");
        // eslint-disable-next-line no-console
        console.log(
            "Hint: Update or remove any packages from `allowedDuplicatePackageVersionsByName`",
        );
        // eslint-disable-next-line no-console
        console.log("that have different duplicate versions than what’s in that map.");
    }

    return {exitCode};
}

main().then(
    ({exitCode}) => {
        process.exit(exitCode);
    },
    error => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exit(1);
    },
);

function areArraysEqual(array1, array2) {
    if (array1.length !== array2.length) return false;

    for (let i = 0; i < array1.length; i++) {
        if (array1[i] !== array2[i]) return false;
    }

    return true;
}

function defaultCompareStrings(string1, string2) {
    if (string1 < string2) return -1;
    if (string1 > string2) return 1;
    return 0;
}
