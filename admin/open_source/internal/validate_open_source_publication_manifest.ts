/* eslint-disable cyberworlds/no-global-error -- Validation errors are boundary diagnostics. */

import * as fs from "node:fs";
import {isBuiltin} from "node:module";
import * as path from "node:path";

import {
    type OpenSourcePublicationManifest,
    type OpenSourcePublicationManifestEntry,
    isOpenSourceStubPath,
    isOpenSourceTaggedPath,
} from "~/admin/open_source/internal/collect_open_source_publication_manifest.js";

type ValidateOpenSourcePublicationManifestArguments = Readonly<{
    allowedBazelPackages: ReadonlySet<string>;
    manifest: OpenSourcePublicationManifest;
    stubDestinations?: ReadonlySet<string>;
    workspacePath?: string;
}>;

/** Validates the fixed publication manifest without selecting another file. */
function validateOpenSourcePublicationManifest({
    allowedBazelPackages,
    manifest,
    stubDestinations,
    workspacePath,
}: ValidateOpenSourcePublicationManifestArguments): void {
    validateOpenSourceEntries({
        entries: manifest.entries,
        stubDestinations,
        workspacePath,
    });
    validateOpenSourcePackagePolicy({
        allowedBazelPackages,
        entries: manifest.entries,
        workspacePath,
    });
    validateOpenSourceImportBoundary(manifest);
    if (!manifest.entries.some(entry => entry.isTest)) {
        throw new Error("Open-source publication must contain at least one public test");
    }
}

function validateOpenSourceEntries({
    entries,
    stubDestinations,
    workspacePath,
}: Pick<ValidateOpenSourcePublicationManifestArguments, "stubDestinations" | "workspacePath"> & {
    entries: ReadonlyArray<OpenSourcePublicationManifestEntry>;
}): void {
    const entryByOutputPath = new Map<string, OpenSourcePublicationManifestEntry>();
    const declaredStubDestinations: ReadonlySet<string> = stubDestinations ?? new Set();
    for (const entry of entries) {
        if (!isOpenSourceTaggedPath(entry.sourceRelativePath)) {
            throw new Error(
                `Open-source publication refused untagged file: ${entry.sourceRelativePath}. ` +
                    "Every published file must include `.open_source` in its file or directory name.",
            );
        }
        assertSafeOpenSourceOutputPath(entry.outputPath);
        if (samePathOrChild(entry.sourceRelativePath, "admin")) {
            throw new Error(
                `Open-source publication refused private file: ${entry.sourceRelativePath}`,
            );
        }
        if (
            entry.outputKind !== "source" &&
            entry.outputKind !== "repository" &&
            entry.outputKind !== "stub"
        ) {
            throw new Error(`Unknown open-source output kind: ${entry.outputKind}`);
        }

        if (isOpenSourceStubPath(entry.sourceRelativePath)) {
            if (entry.outputKind !== "stub") {
                throw new Error(
                    `Open-source stub ${entry.sourceRelativePath} must have output kind \`stub\``,
                );
            }
            if (isOpenSourceTaggedPath(entry.outputPath)) {
                throw new Error(
                    `Open-source stub ${entry.sourceRelativePath} must overwrite an untagged ` +
                        `path, but maps to ${entry.outputPath}`,
                );
            }
            if (stubDestinations) {
                if (!declaredStubDestinations.has(entry.outputPath)) {
                    throw new Error(
                        `Open-source stub ${entry.sourceRelativePath} must replace a Bazel-declared ` +
                            `private file at ${entry.outputPath}`,
                    );
                }
            } else {
                if (!workspacePath) {
                    throw new Error(
                        "Expected a workspace path when validating an undeclared open-source stub",
                    );
                }
                const privatePath = path.resolve(workspacePath, ...entry.outputPath.split("/"));
                if (!fs.existsSync(privatePath) || !fs.statSync(privatePath).isFile()) {
                    throw new Error(
                        `Open-source stub ${entry.sourceRelativePath} must overwrite an existing ` +
                            `non-open-source file at ${entry.outputPath}`,
                    );
                }
            }
        }

        const conflictingEntry = entryByOutputPath.get(entry.outputPath);
        if (conflictingEntry) throw publicationConflictError(conflictingEntry, entry);
        entryByOutputPath.set(entry.outputPath, entry);
    }

    for (const entry of entries) {
        let ancestorPath = path.posix.dirname(entry.outputPath);
        while (ancestorPath !== ".") {
            const conflictingEntry = entryByOutputPath.get(ancestorPath);
            if (conflictingEntry) throw publicationConflictError(conflictingEntry, entry);
            ancestorPath = path.posix.dirname(ancestorPath);
        }
    }

    if (stubDestinations) {
        for (const destinationPath of declaredStubDestinations) {
            const entry = entryByOutputPath.get(destinationPath);
            if (!entry || entry.outputKind !== "stub") {
                throw new Error(
                    `Bazel-declared private stub destination ${destinationPath} has no ` +
                        "corresponding `.open_source.stub` file",
                );
            }
        }
    }
}

function validateOpenSourcePackagePolicy({
    allowedBazelPackages,
    entries,
    workspacePath,
}: Pick<
    ValidateOpenSourcePublicationManifestArguments,
    "allowedBazelPackages" | "workspacePath"
> & {entries: ReadonlyArray<OpenSourcePublicationManifestEntry>}): void {
    const violationByFilePath = new Map<
        string,
        {bazelPackage: string; reasons: ReadonlyArray<string>}
    >();
    for (const entry of entries) {
        const bazelPackage = workspacePath
            ? bazelPackageForWorkspaceSource({sourcePath: entry.inputPath, workspacePath})
            : bazelPackageForDeclaredSource({
                  allowedBazelPackages,
                  sourceRelativePath: entry.sourceRelativePath,
              });
        if (!allowedBazelPackages.has(bazelPackage)) {
            violationByFilePath.set(entry.sourceRelativePath, {
                bazelPackage,
                reasons: entry.selectionReasons,
            });
        }
    }
    if (violationByFilePath.size === 0) return;

    const files = [...violationByFilePath]
        .sort(([leftPath], [rightPath]) => leftPath.localeCompare(rightPath))
        .map(
            ([filePath, {bazelPackage, reasons}]) =>
                `  - ${filePath} (${bazelPackage}; ${reasons.join(", ")})`,
        )
        .join("\n");
    const packages = [
        ...new Set([...violationByFilePath.values()].map(value => value.bazelPackage)),
    ]
        .sort()
        .map(bazelPackage => `  - ${bazelPackage}`)
        .join("\n");
    throw new Error(`Open-source publication refused. These files are in Bazel packages that are not centrally allowed:
${files}

After reviewing them for public release, add these package labels to \`allowed_bazel_packages\` in \`//admin/open_source:BUILD\`:
${packages}`);
}

function validateOpenSourceImportBoundary(manifest: OpenSourcePublicationManifest): void {
    const outputPaths = new Set(manifest.entries.map(entry => entry.outputPath));
    const publicPackageNames = listPublicPackageNames(manifest.entries);
    const violations: Array<string> = [];

    for (const edge of manifest.importEdges) {
        if (edge.moduleSpecifier.includes(".open_source.stub")) {
            violations.push(
                `${edge.fromSourcePath} imports stub path \`${edge.moduleSpecifier}\`. ` +
                    "Import the canonical untagged path; the archive swaps the stub in place.",
            );
            continue;
        }
        if (edge.kind === "bare") {
            const packageName = packageNameForSpecifier(edge.moduleSpecifier);
            if (!isBuiltin(edge.moduleSpecifier) && !publicPackageNames.has(packageName)) {
                violations.push(
                    `${edge.fromSourcePath} imports undeclared public package \`${edge.moduleSpecifier}\``,
                );
            }
            continue;
        }
        if (!outputPaths.has(edge.toOutputPath)) {
            violations.push(
                `${edge.fromSourcePath} imports \`${edge.moduleSpecifier}\`, but ` +
                    `\`${edge.toOutputPath}\` is not selected for open source`,
            );
        }
    }
    if (violations.length > 0) {
        throw new Error(
            `Open-source import validation failed:\n${violations
                .sort()
                .map(violation => `  - ${violation}`)
                .join("\n")}`,
        );
    }
}

function listPublicPackageNames(
    entries: ReadonlyArray<OpenSourcePublicationManifestEntry>,
): Set<string> {
    const packageNames = new Set<string>();
    for (const entry of entries) {
        if (path.posix.basename(entry.outputPath) !== "package.json") continue;
        const packageJson: unknown = JSON.parse(fs.readFileSync(entry.inputPath, "utf8"));
        if (!isRecord(packageJson)) {
            throw new Error(
                `Public package manifest must be an object: ${entry.sourceRelativePath}`,
            );
        }
        for (const dependencyGroup of [
            packageJson.dependencies,
            packageJson.devDependencies,
            packageJson.optionalDependencies,
            packageJson.peerDependencies,
        ]) {
            if (!isRecord(dependencyGroup)) continue;
            for (const packageName of Object.keys(dependencyGroup)) {
                packageNames.add(packageName);
                const typedPackageName = moduleNameForDefinitelyTypedPackage(packageName);
                if (typedPackageName) packageNames.add(typedPackageName);
            }
        }
    }
    return packageNames;
}

/**
 * Returns the module name supplied by a package from the DefinitelyTyped
 * namespace.
 */
function moduleNameForDefinitelyTypedPackage(packageName: string): string | undefined {
    if (!packageName.startsWith("@types/")) return undefined;
    const typedName = packageName.slice("@types/".length);
    const scopedSeparatorIndex = typedName.indexOf("__");
    if (scopedSeparatorIndex === -1) return typedName;
    return `@${typedName.slice(0, scopedSeparatorIndex)}/${typedName.slice(scopedSeparatorIndex + 2)}`;
}

function packageNameForSpecifier(moduleSpecifier: string): string {
    if (!moduleSpecifier.startsWith("@")) return moduleSpecifier.split("/", 1)[0] ?? "";
    return moduleSpecifier.split("/").slice(0, 2).join("/");
}

function bazelPackageForWorkspaceSource({
    sourcePath,
    workspacePath,
}: {
    sourcePath: string;
    workspacePath: string;
}): string {
    let directoryPath = path.dirname(sourcePath);
    const resolvedWorkspacePath = path.resolve(workspacePath);
    while (sameFilesystemPathOrChild(directoryPath, resolvedWorkspacePath)) {
        if (
            fs.existsSync(path.join(directoryPath, "BUILD")) ||
            fs.existsSync(path.join(directoryPath, "BUILD.bazel"))
        ) {
            const packagePath = toPosixPath(path.relative(resolvedWorkspacePath, directoryPath));
            return packagePath.length === 0 ? "//" : `//${packagePath}`;
        }
        if (directoryPath === resolvedWorkspacePath) break;
        directoryPath = path.dirname(directoryPath);
    }
    throw new Error(
        `Could not find a Bazel package for ${path.relative(resolvedWorkspacePath, sourcePath)}`,
    );
}

/**
 * Finds the configured package root for a Bazel-declared public source.
 *
 * The Starlark aspect has already selected files from reviewed package roots. The
 * manifest records only paths, so this boundary check uses the same roots without
 * reopening the private worktree.
 */
function bazelPackageForDeclaredSource({
    allowedBazelPackages,
    sourceRelativePath,
}: {
    allowedBazelPackages: ReadonlySet<string>;
    sourceRelativePath: string;
}): string {
    const matchingPackage = [...allowedBazelPackages]
        .filter(packageLabel => {
            if (packageLabel === "//") return false;
            const packagePath = packageLabel.slice("//".length);
            return (
                sourceRelativePath === packagePath ||
                sourceRelativePath.startsWith(`${packagePath}/`)
            );
        })
        .sort((left, right) => right.length - left.length)[0];
    if (matchingPackage) return matchingPackage;
    if (isRootBazelPackageSource(sourceRelativePath)) return "//";
    return `//${path.posix.dirname(sourceRelativePath)}`;
}

/**
 * Repository metadata and package manifests belong to the root Bazel package.
 */
function isRootBazelPackageSource(sourceRelativePath: string): boolean {
    const rootDirectory = sourceRelativePath.split("/", 1)[0] ?? "";
    return (
        !sourceRelativePath.includes("/") ||
        rootDirectory.startsWith(".") ||
        rootDirectory === "packages" ||
        rootDirectory === "scripts"
    );
}

function assertSafeOpenSourceOutputPath(outputPath: string): void {
    if (
        outputPath.length === 0 ||
        path.posix.isAbsolute(outputPath) ||
        outputPath.split("/").some(part => part.length === 0 || part === "." || part === "..")
    ) {
        throw new Error(`Unsafe open-source output path: ${outputPath}`);
    }
    if (outputPath === ".git" || outputPath.startsWith(".git/")) {
        throw new Error(`Static repository files may not replace \`.git\`: ${outputPath}`);
    }
}

function publicationConflictError(
    left: OpenSourcePublicationManifestEntry,
    right: OpenSourcePublicationManifestEntry,
): Error {
    const conflictPath =
        left.outputPath === right.outputPath
            ? left.outputPath
            : left.outputPath.length < right.outputPath.length
              ? left.outputPath
              : right.outputPath;
    return new Error(
        `Open-source output conflict at \`${conflictPath}\`: ` +
            `\`${left.sourceRelativePath}\` conflicts with \`${right.sourceRelativePath}\`.`,
    );
}

function samePathOrChild(childPath: string, parentPath: string): boolean {
    return childPath === parentPath || childPath.startsWith(`${parentPath}/`);
}

function sameFilesystemPathOrChild(childPath: string, parentPath: string): boolean {
    const relativePath = path.relative(path.resolve(parentPath), path.resolve(childPath));
    return (
        relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
    );
}

function toPosixPath(filePath: string): string {
    return filePath.split(path.sep).join("/");
}

function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export {validateOpenSourcePublicationManifest};
