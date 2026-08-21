/* eslint-disable cyberworlds/no-global-error -- Errors name malformed YAML or undeclared patches. */

import * as fs from "node:fs";
import * as path from "node:path";

import Yaml from "yaml";

import {
    type OpenSourceDeclaredSource,
    type OpenSourcePublicationManifest,
    type OpenSourcePublicationManifestEntry,
} from "~/admin/open_source/internal/collect_open_source_publication_manifest.js";

type OpenSourceCliPatchListEntry = Readonly<{
    packageName: string;
    sourceFileName: string;
    version: string;
}>;

/**
 * Adds the private pnpm patches required by the public CLI to the archive
 * manifest.
 *
 * Patch files stay in `admin/patches`, which is not public source. The generated
 * list explicitly selects the files to copy into `packages/cli/patches`, where
 * npm's patch-package can apply them.
 */
function appendOpenSourceCliPatchEntries({
    cliPatchListPath,
    cliPatchSources,
    manifest,
}: {
    cliPatchListPath: string;
    cliPatchSources: ReadonlyArray<OpenSourceDeclaredSource>;
    manifest: OpenSourcePublicationManifest;
}): OpenSourcePublicationManifest {
    const patchEntries = readOpenSourceCliPatchList(cliPatchListPath);
    const patchSourceByFileName = new Map<string, OpenSourceDeclaredSource>();
    for (const patchSource of cliPatchSources) {
        const sourceFileName = path.posix.basename(patchSource.sourceRelativePath);
        if (patchSourceByFileName.has(sourceFileName)) {
            throw new Error(`Multiple declared private patches are named ${sourceFileName}`);
        }
        patchSourceByFileName.set(sourceFileName, patchSource);
    }

    const patchManifestEntries = patchEntries.map(patchEntry => {
        const patchSource = patchSourceByFileName.get(patchEntry.sourceFileName);
        if (!patchSource) {
            throw new Error(
                `Private CLI patch list references undeclared patch ${patchEntry.sourceFileName}`,
            );
        }
        return {
            contentTransform: {kind: "patch-package", packageName: patchEntry.packageName},
            inputPath: patchSource.inputPath,
            isTest: false,
            outputKind: "repository",
            outputPath: `packages/cli/patches/${patchPackageFileName(patchEntry)}`,
            selectionReasons: ["CLI patch list"],
            // The public path must look like an ordinary CLI package file even though the
            // patch begins in the private patch directory. Keep the private source path in the
            // manifest so archive validation can still account for every input.
            sourceRelativePath: `packages/cli/patches.open_source/${patchPackageFileName(patchEntry)}`,
        } satisfies OpenSourcePublicationManifestEntry;
    });

    return {
        entries: [...manifest.entries, ...patchManifestEntries].sort((left, right) =>
            left.outputPath.localeCompare(right.outputPath),
        ),
        importEdges: manifest.importEdges,
    };
}

function readOpenSourceCliPatchList(
    cliPatchListPath: string,
): ReadonlyArray<OpenSourceCliPatchListEntry> {
    let patchList: unknown;
    try {
        patchList = Yaml.parse(fs.readFileSync(cliPatchListPath, "utf8"));
    } catch (error) {
        throw new Error(`Invalid private CLI patch list: ${errorMessage(error)}`);
    }
    if (!Array.isArray(patchList)) {
        throw new Error("Invalid private CLI patch list: expected an array");
    }

    const patchEntries: Array<OpenSourceCliPatchListEntry> = [];
    const fileNames = new Set<string>();
    const packageNames = new Set<string>();
    for (const patchEntry of patchList) {
        if (!isOpenSourceCliPatchListEntry(patchEntry)) {
            throw new Error(
                "Invalid private CLI patch list: every entry must contain a root patch file, package, and version",
            );
        }
        if (fileNames.has(patchEntry.sourceFileName) || packageNames.has(patchEntry.packageName)) {
            throw new Error(
                "Invalid private CLI patch list: patch files and packages must be unique",
            );
        }
        fileNames.add(patchEntry.sourceFileName);
        packageNames.add(patchEntry.packageName);
        patchEntries.push(patchEntry);
    }
    return patchEntries;
}

function isOpenSourceCliPatchListEntry(value: unknown): value is OpenSourceCliPatchListEntry {
    if (!isRecord(value)) return false;
    return (
        isOpenSourceCliPatchFileName(value.sourceFileName) &&
        isNonemptyString(value.packageName) &&
        isNonemptyString(value.version)
    );
}

function patchPackageFileName({packageName, version}: OpenSourceCliPatchListEntry): string {
    return `${packageName.replaceAll("/", "+")}+${version}.dev.patch`;
}

function isOpenSourceCliPatchFileName(fileName: unknown): fileName is string {
    return (
        isNonemptyString(fileName) &&
        path.posix.basename(fileName) === fileName &&
        fileName.endsWith(".patch")
    );
}

function isNonemptyString(value: unknown): value is string {
    return typeof value === "string" && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export {appendOpenSourceCliPatchEntries};
