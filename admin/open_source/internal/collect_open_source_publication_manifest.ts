/* eslint-disable cyberworlds/no-global-error -- Collection errors describe Bazel input boundaries. */

import * as fs from "node:fs";

import {
    listOpenSourceModuleSpecifiers,
    resolveOpenSourceDeclaredImport,
} from "~/admin/open_source/internal/open_source_source_graph.js";

/** One tagged source file declared as an input to the Bazel archive action. */
export type OpenSourceDeclaredSource = Readonly<{
    inputPath: string;
    sourceRelativePath: string;
}>;

/**
 * The destination category determines whether a file is source, metadata, or a
 * replacement stub.
 */
export type OpenSourceOutputKind = "repository" | "source" | "stub";

/**
 * A single source file and the public path it creates in the generated repository.
 */
export type OpenSourcePublicationManifestEntry = Readonly<{
    inputPath: string;
    isTest: boolean;
    outputKind: OpenSourceOutputKind;
    outputPath: string;
    selectionReasons: ReadonlyArray<string>;
    sourceRelativePath: string;
}>;

/**
 * An import whose module name is resolved by npm in the generated repository.
 */
export type OpenSourceBareImportEdge = Readonly<{
    fromOutputPath: string;
    fromSourcePath: string;
    kind: "bare";
    moduleSpecifier: string;
}>;

/** An import between two files written into the generated repository. */
export type OpenSourceWorkspaceImportEdge = Readonly<{
    fromOutputPath: string;
    fromSourcePath: string;
    kind: "virtual" | "workspace";
    moduleSpecifier: string;
    toOutputPath: string;
}>;

export type OpenSourceImportEdge = OpenSourceBareImportEdge | OpenSourceWorkspaceImportEdge;

/** The complete, fixed input and output record for one archive action. */
export type OpenSourcePublicationManifest = Readonly<{
    entries: ReadonlyArray<OpenSourcePublicationManifestEntry>;
    importEdges: ReadonlyArray<OpenSourceImportEdge>;
}>;

const virtualImportOutputPathBySpecifier = new Map<string, string>([
    [
        "~/server/agents/web/agent_web_skill_content_by_path.js",
        "server/agents/web/agent_web_skill_content_by_path.js",
    ],
]);
const openSourceFileTag = ".open_source";
const openSourceStubTag = ".open_source.stub";
const sourceRootNames = new Set(["app", "client", "native", "server", "shared", "skills"]);
const taggedPathSelectionReason = "tagged path";

/**
 * Builds an immutable publication manifest from the files declared by the Bazel
 * rule.
 *
 * The input list is complete by construction. This function must never inspect the
 * worktree to find another source: doing so would make the archive's cache key
 * depend on hidden state.
 */
function collectOpenSourcePublicationManifestFromDeclaredSources({
    stubDestinations,
    sourceInputs,
}: {
    stubDestinations: ReadonlySet<string>;
    sourceInputs: ReadonlyArray<OpenSourceDeclaredSource>;
}): OpenSourcePublicationManifest {
    const entries: Array<OpenSourcePublicationManifestEntry> = sourceInputs
        .map(({inputPath, sourceRelativePath}) => {
            assertSafeOpenSourceSourcePath(sourceRelativePath, "Bazel source input");
            assertRegularFile(inputPath, `Tagged open-source path \`${sourceRelativePath}\``);
            return createOpenSourceManifestEntry({
                inputPath,
                reasons: new Set([taggedPathSelectionReason]),
                sourceRelativePath,
            });
        })
        .sort((left, right) => left.outputPath.localeCompare(right.outputPath));
    const importEdges = listDeclaredManifestImportEdges({entries, stubDestinations});
    return deepFreeze({entries, importEdges});
}

/**
 * Maps one declared tagged file to its public path without adding new files.
 */
function createOpenSourceManifestEntry({
    inputPath,
    reasons,
    sourceRelativePath,
}: {
    inputPath: string;
    reasons: ReadonlySet<string>;
    sourceRelativePath: string;
}): OpenSourcePublicationManifestEntry {
    const outputKind = openSourceOutputKind({reasons, sourceRelativePath});
    return {
        inputPath,
        isTest: isOpenSourceTestPath(sourceRelativePath),
        outputKind,
        outputPath: stripOpenSourceTagsFromPath(sourceRelativePath),
        selectionReasons: [...reasons].sort(),
        sourceRelativePath,
    };
}

/** Records import edges while reading only the declared source files. */
function listDeclaredManifestImportEdges({
    entries,
    stubDestinations,
}: {
    entries: ReadonlyArray<OpenSourcePublicationManifestEntry>;
    stubDestinations: ReadonlySet<string>;
}): Array<OpenSourceImportEdge> {
    const edges: Array<OpenSourceImportEdge> = [];
    const entryBySourcePath = new Map<string, OpenSourcePublicationManifestEntry>(
        entries.map(entry => [entry.sourceRelativePath, entry]),
    );
    const availableSourcePaths = new Set([...entryBySourcePath.keys(), ...stubDestinations]);
    for (const entry of entries) {
        if (!isJavaScriptOrTypeScriptPath(entry.outputPath)) continue;
        const source = fs.readFileSync(entry.inputPath, "utf8");
        for (const moduleSpecifier of listOpenSourceModuleSpecifiers(
            source,
            entry.sourceRelativePath,
        )) {
            const virtualOutputPath = virtualImportOutputPathBySpecifier.get(moduleSpecifier);
            if (virtualOutputPath) {
                edges.push({
                    fromOutputPath: entry.outputPath,
                    fromSourcePath: entry.sourceRelativePath,
                    kind: "virtual",
                    moduleSpecifier,
                    toOutputPath: virtualOutputPath,
                });
                continue;
            }
            const importedPath = resolveOpenSourceDeclaredImport({
                availableSourcePaths,
                moduleSpecifier,
                sourceRelativePath: entry.sourceRelativePath,
            });
            edges.push(
                importedPath
                    ? {
                          fromOutputPath: entry.outputPath,
                          fromSourcePath: entry.sourceRelativePath,
                          kind: "workspace",
                          moduleSpecifier,
                          toOutputPath:
                              entryBySourcePath.get(importedPath)?.outputPath ??
                              (stubDestinations.has(importedPath)
                                  ? importedPath
                                  : outputPathForUnselectedImport({importedPath})),
                      }
                    : {
                          fromOutputPath: entry.outputPath,
                          fromSourcePath: entry.sourceRelativePath,
                          kind: "bare",
                          moduleSpecifier,
                      },
            );
        }
    }
    return edges.sort((left, right) =>
        `${left.fromOutputPath}\0${left.moduleSpecifier}`.localeCompare(
            `${right.fromOutputPath}\0${right.moduleSpecifier}`,
        ),
    );
}

/**
 * Classifies source files separately from public repository metadata in the audit
 * manifest.
 */
function openSourceOutputKind({
    reasons,
    sourceRelativePath,
}: {
    reasons: ReadonlySet<string>;
    sourceRelativePath: string;
}): OpenSourceOutputKind {
    if (isOpenSourceStubPath(sourceRelativePath)) return "stub";
    const selectedOnlyByTag = reasons.size === 1 && reasons.has(taggedPathSelectionReason);
    const sourceRootName = sourceRelativePath.split("/", 1)[0] ?? "";
    return selectedOnlyByTag && !sourceRootNames.has(sourceRootName) ? "repository" : "source";
}

function outputPathForUnselectedImport({importedPath}: {importedPath: string}): string {
    return isOpenSourceTaggedPath(importedPath)
        ? stripOpenSourceTagsFromPath(importedPath)
        : importedPath;
}

function stripOpenSourceTagsFromPath(filePath: string): string {
    let removedTag = false;
    const outputParts = filePath.split("/").map(part => {
        const tagMatches = [...part.matchAll(/\.open_source(?:\.stub)?/gu)];
        const firstTagMatch = tagMatches[0];
        if (firstTagMatch === undefined || firstTagMatch.index === undefined) return part;
        const marker = firstTagMatch[0];
        const markerIndex = firstTagMatch.index;
        removedTag = true;
        if (tagMatches.length > 1) {
            throw new Error(
                `More than one \`${openSourceFileTag}\` tag in path component \`${part}\``,
            );
        }
        const suffix = part.slice(markerIndex + marker.length);
        if (suffix.length > 0 && !suffix.startsWith(".")) {
            throw new Error(`Invalid \`${openSourceFileTag}\` tag in ${filePath}`);
        }
        const outputPart = part.slice(0, markerIndex) + suffix;
        if (outputPart.length === 0) {
            throw new Error(
                `Empty path component after stripping \`${openSourceFileTag}\`: ${filePath}`,
            );
        }
        return outputPart;
    });
    if (!removedTag) throw new Error(`Missing \`${openSourceFileTag}\` in ${filePath}`);
    return outputParts.join("/");
}

function isOpenSourceTaggedPath(filePath: string): boolean {
    return filePath
        .split("/")
        .some(part => part.endsWith(openSourceFileTag) || part.includes(`${openSourceFileTag}.`));
}

function isOpenSourceStubPath(filePath: string): boolean {
    return filePath.split("/").some(part => part.includes(openSourceStubTag));
}

function isOpenSourceTestPath(filePath: string): boolean {
    return /\.open_source\.test\.[cm]?[jt]sx?$/u.test(filePath);
}

function isJavaScriptOrTypeScriptPath(filePath: string): boolean {
    return /\.[cm]?[jt]sx?$/u.test(filePath);
}

/** Rejects a path that cannot safely name one workspace file. */
function assertSafeOpenSourceSourcePath(filePath: string, description: string): void {
    if (
        filePath.length === 0 ||
        filePath.startsWith("/") ||
        filePath.split("/").some(part => part.length === 0 || part === "." || part === "..")
    ) {
        throw new Error(`Unsafe workspace-relative source path: ${description}`);
    }
}

function assertRegularFile(filePath: string, description: string): void {
    const stats = fs.lstatSync(filePath);
    if (!stats.isFile()) throw new Error(`${description} is not a regular file: ${filePath}`);
}

function deepFreeze<Value>(value: Value): Value {
    if (!value || typeof value !== "object" || Object.isFrozen(value)) return value;
    for (const child of Object.values(value)) deepFreeze(child);
    return Object.freeze(value);
}

export {
    collectOpenSourcePublicationManifestFromDeclaredSources,
    isOpenSourceStubPath,
    isOpenSourceTaggedPath,
    stripOpenSourceTagsFromPath,
};
