/* eslint-disable cyberworlds/no-global-error -- CLI configuration errors include user input. */

import * as fs from "node:fs";
import * as path from "node:path";
import {parseArgs} from "node:util";

import {type OpenSourceDeclaredSource} from "~/admin/open_source/internal/collect_open_source_publication_manifest.js";

/**
 * Paths and policy parsed from the command-line arguments and JSON files Bazel
 * writes.
 */
export type OpenSourceArchiveContext = Readonly<{
    allowedBazelPackages: ReadonlySet<string>;
    cliPatchListPath: string;
    cliPatchSources: ReadonlyArray<OpenSourceDeclaredSource>;
    inputSources: ReadonlyArray<OpenSourceDeclaredSource>;
    manifestOutputPath: string;
    outputArchivePath: string;
    stubDestinations: ReadonlySet<string>;
    zipperPath: string;
}>;

/** Reads the only inputs the Bazel archive action passes to the publisher. */
function readOpenSourceArchiveContext({
    argv = process.argv.slice(2),
}: {
    argv?: Array<string>;
}): OpenSourceArchiveContext {
    let parsedArgs;
    try {
        parsedArgs = parseArgs({
            args: argv,
            options: {
                configuration: {type: "string"},
                "input-manifest": {type: "string"},
                "manifest-output": {type: "string"},
                "output-archive": {type: "string"},
                zipper: {type: "string"},
            },
            strict: true,
        });
    } catch (error) {
        throw new Error(`${errorMessage(error)}\n${openSourceArchiveUsage()}`);
    }

    const configurationPath = requireOpenSourceArchiveArgument(
        parsedArgs.values.configuration,
        "--configuration",
    );
    const inputManifestPath = requireOpenSourceArchiveArgument(
        parsedArgs.values["input-manifest"],
        "--input-manifest",
    );
    return {
        allowedBazelPackages: parseOpenSourceConfiguration(
            fs.readFileSync(configurationPath, "utf8"),
        ).allowedBazelPackages,
        ...parseOpenSourceArchiveInputManifest(fs.readFileSync(inputManifestPath, "utf8")),
        manifestOutputPath: path.resolve(
            requireOpenSourceArchiveArgument(
                parsedArgs.values["manifest-output"],
                "--manifest-output",
            ),
        ),
        outputArchivePath: path.resolve(
            requireOpenSourceArchiveArgument(
                parsedArgs.values["output-archive"],
                "--output-archive",
            ),
        ),
        zipperPath: path.resolve(
            requireOpenSourceArchiveArgument(parsedArgs.values.zipper, "--zipper"),
        ),
    };
}

/**
 * Validates the JSON input manifest that `open_source_repository.bzl` writes
 * before the publisher reads its paths.
 */
function parseOpenSourceArchiveInputManifest(inputManifestJson: string): {
    cliPatchListPath: string;
    cliPatchSources: ReadonlyArray<OpenSourceDeclaredSource>;
    inputSources: ReadonlyArray<OpenSourceDeclaredSource>;
    stubDestinations: ReadonlySet<string>;
} {
    let inputManifest: unknown;
    try {
        inputManifest = JSON.parse(inputManifestJson);
    } catch (error) {
        throw new Error(`Invalid open-source archive input manifest: ${errorMessage(error)}`);
    }
    if (!isRecord(inputManifest)) {
        throw new Error("Invalid open-source archive input manifest: expected an object");
    }

    const {cliPatchListPath, cliPatchSources, stubDestinations, sources} = inputManifest;
    if (typeof cliPatchListPath !== "string" || cliPatchListPath.length === 0) {
        throw new Error(
            "Invalid open-source archive input manifest: `cliPatchListPath` must be a file path",
        );
    }
    const parsedCliPatchSources = parseOpenSourceDeclaredSources({
        fieldName: "cliPatchSources",
        value: cliPatchSources,
    });
    if (
        !Array.isArray(stubDestinations) ||
        stubDestinations.some(destinationPath => !isSafeOpenSourcePath(destinationPath)) ||
        new Set(stubDestinations).size !== stubDestinations.length
    ) {
        throw new Error(
            "Invalid open-source archive input manifest: `stubDestinations` must contain " +
                "unique workspace-relative paths",
        );
    }
    const inputSources = parseOpenSourceDeclaredSources({fieldName: "sources", value: sources});
    if (inputSources.length === 0) {
        throw new Error("Invalid open-source archive input manifest: `sources` must not be empty");
    }
    return {
        cliPatchListPath,
        cliPatchSources: parsedCliPatchSources,
        inputSources,
        stubDestinations: new Set(stubDestinations),
    };
}

function parseOpenSourceDeclaredSources({
    fieldName,
    value,
}: {
    fieldName: string;
    value: unknown;
}): Array<OpenSourceDeclaredSource> {
    if (!Array.isArray(value)) {
        throw new Error(
            `Invalid open-source archive input manifest: \`${fieldName}\` must contain unique ` +
                "input and workspace-relative paths",
        );
    }
    const sources: Array<OpenSourceDeclaredSource> = [];
    for (const source of value) {
        if (!isOpenSourceDeclaredSource(source)) {
            throw new Error(
                `Invalid open-source archive input manifest: \`${fieldName}\` must contain unique ` +
                    "input and workspace-relative paths",
            );
        }
        sources.push(source);
    }
    const sourceRelativePaths = sources.map(source => source.sourceRelativePath);
    if (new Set(sourceRelativePaths).size !== sources.length) {
        throw new Error(
            `Invalid open-source archive input manifest: \`${fieldName}\` must contain unique ` +
                "input and workspace-relative paths",
        );
    }
    return sources;
}

/** Parses the package allowlist JSON written by `open_source_configuration`. */
function parseOpenSourceConfiguration(configurationJson: string): {
    allowedBazelPackages: ReadonlySet<string>;
} {
    let configuration: unknown;
    try {
        configuration = JSON.parse(configurationJson);
    } catch (error) {
        throw new Error(`Invalid open-source configuration: ${errorMessage(error)}`);
    }
    if (!isRecord(configuration)) {
        throw new Error("Invalid open-source configuration: expected an object");
    }

    const {allowedBazelPackages} = configuration;
    if (
        !Array.isArray(allowedBazelPackages) ||
        allowedBazelPackages.length === 0 ||
        allowedBazelPackages.some(packageLabel => !isBazelPackageLabel(packageLabel)) ||
        new Set(allowedBazelPackages).size !== allowedBazelPackages.length
    ) {
        throw new Error(
            "Invalid open-source configuration: `allowedBazelPackages` must contain " +
                "unique Bazel package labels",
        );
    }
    return {allowedBazelPackages: new Set(allowedBazelPackages)};
}

function requireOpenSourceArchiveArgument(value: string | undefined, name: string): string {
    if (!value) throw new Error(`Expected ${name} when packaging the open-source archive`);
    return value;
}

function isSafeOpenSourcePath(filePath: unknown): filePath is string {
    return (
        typeof filePath === "string" &&
        filePath.length > 0 &&
        !path.posix.isAbsolute(filePath) &&
        !filePath.split("/").some(part => part.length === 0 || part === "." || part === "..")
    );
}

function isBazelPackageLabel(packageLabel: unknown): packageLabel is string {
    return (
        typeof packageLabel === "string" &&
        packageLabel.startsWith("//") &&
        !packageLabel.includes(":") &&
        (packageLabel === "//" || !packageLabel.endsWith("/"))
    );
}

function isOpenSourceDeclaredSource(value: unknown): value is OpenSourceDeclaredSource {
    if (!isRecord(value)) return false;
    return (
        typeof value.inputPath === "string" &&
        value.inputPath.length > 0 &&
        isSafeOpenSourcePath(value.sourceRelativePath)
    );
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function openSourceArchiveUsage(): string {
    return (
        "Usage: package_open_source_repository --configuration <path> --input-manifest <path> " +
        "--output-archive <path> --manifest-output <path> --zipper <path>"
    );
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export {
    parseOpenSourceArchiveInputManifest,
    parseOpenSourceConfiguration,
    readOpenSourceArchiveContext,
};
