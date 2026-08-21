/* eslint-disable cyberworlds/no-global-error -- Zipper failures retain captured stderr detail. */

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import * as ts from "typescript";

import {
    type OpenSourcePublicationManifest,
    type OpenSourcePublicationManifestEntry,
} from "~/admin/open_source/internal/collect_open_source_publication_manifest.js";
import {
    type OpenSourceRenameEntry,
    replaceOpenSourceRepositoryContents,
    resolveSafeOpenSourceOutput,
} from "~/admin/open_source/internal/replace_open_source_repository.js";

const openSourceFileTag = ".open_source";
const openSourceStubTag = ".open_source.stub";

type PackageOpenSourcePublicationManifestArguments = Readonly<{
    buildOutputRootPath?: string;
    manifest: OpenSourcePublicationManifest;
    manifestOutputPath?: string;
    outputRepositoryPath: string;
    renameEntry?: OpenSourceRenameEntry;
    workspacePath: string;
}>;

type ArchiveOpenSourcePublicationManifestArguments = Readonly<{
    archivePath: string;
    manifest: OpenSourcePublicationManifest;
    manifestOutputPath?: string;
    zipperPath: string;
}>;

function isOpenSourceTaggedPath(filePath: string): boolean {
    return filePath
        .split("/")
        .some(part => part.endsWith(openSourceFileTag) || part.includes(`${openSourceFileTag}.`));
}

function stripOpenSourceTagsFromPath(filePath: string): string {
    return filePath
        .split("/")
        .map(part => {
            const stubMarkerIndex = part.indexOf(openSourceStubTag);
            const marker = stubMarkerIndex === -1 ? openSourceFileTag : openSourceStubTag;
            const markerIndex = part.indexOf(marker);
            if (markerIndex === -1) return part;
            const suffix = part.slice(markerIndex + marker.length);
            return part.slice(0, markerIndex) + suffix;
        })
        .join("/");
}

/**
 * Writes the validated manifest to a staging directory, then replaces the
 * destination only after every file was written.
 */
function packageOpenSourcePublicationManifest({
    buildOutputRootPath,
    manifest,
    manifestOutputPath,
    outputRepositoryPath,
    renameEntry = fs.renameSync,
    workspacePath,
}: PackageOpenSourcePublicationManifestArguments) {
    const safeOutput = resolveSafeOpenSourceOutput({
        buildOutputRootPath,
        outputRepositoryPath,
        workspacePath,
    });
    if (safeOutput.createOutputRepository) {
        fs.mkdirSync(safeOutput.outputRepositoryPath, {recursive: true});
    }

    materializeOpenSourceManifest({
        manifest,
        outputRepositoryPath: safeOutput.outputRepositoryPath,
        renameEntry,
    });
    if (manifestOutputPath) writeOpenSourceManifest(manifestOutputPath, manifest);
    return manifest.entries;
}

/**
 * Writes the validated public files to a staging directory, then adds those files
 * to the ZIP with Bazel's zipper.
 */
function archiveOpenSourcePublicationManifest({
    archivePath,
    manifest,
    manifestOutputPath,
    zipperPath,
}: ArchiveOpenSourcePublicationManifestArguments) {
    const resolvedArchivePath = path.resolve(archivePath);
    const stagingPath = fs.mkdtempSync(
        path.join(path.dirname(resolvedArchivePath), ".open-source-archive-staging-"),
    );

    try {
        writeOpenSourceRepositoryFiles({manifest, outputRepositoryPath: stagingPath});
        createOpenSourceArchive({
            archivePath: resolvedArchivePath,
            outputPaths: manifest.entries.map(entry => entry.outputPath),
            repositoryPath: stagingPath,
            zipperPath,
        });
        if (manifestOutputPath) writeOpenSourceManifest(manifestOutputPath, manifest);
        return manifest.entries;
    } finally {
        fs.rmSync(stagingPath, {force: true, recursive: true});
    }
}

function materializeOpenSourceManifest({
    manifest,
    outputRepositoryPath,
    renameEntry,
}: Pick<
    PackageOpenSourcePublicationManifestArguments,
    "manifest" | "outputRepositoryPath" | "renameEntry"
>): void {
    const resolvedOutputPath = path.resolve(outputRepositoryPath);
    const outputParentPath = path.dirname(resolvedOutputPath);
    const outputName = path.basename(resolvedOutputPath);
    const stagingPath = fs.mkdtempSync(
        path.join(outputParentPath, `.${outputName}.open-source-staging-`),
    );
    let backupPath: string | undefined;
    let shouldRemoveBackup = true;

    try {
        backupPath = fs.mkdtempSync(
            path.join(outputParentPath, `.${outputName}.open-source-backup-`),
        );
        writeOpenSourceRepositoryFiles({manifest, outputRepositoryPath: stagingPath});

        shouldRemoveBackup = false;
        const replacementResult = replaceOpenSourceRepositoryContents({
            backupPath,
            outputRepositoryPath: resolvedOutputPath,
            renameEntry,
            stagingPath,
        });
        if (replacementResult.ok || !replacementResult.preserveBackup) shouldRemoveBackup = true;
        if (!replacementResult.ok) throw replacementResult.error;
    } finally {
        fs.rmSync(stagingPath, {force: true, recursive: true});
        if (backupPath && shouldRemoveBackup) {
            fs.rmSync(backupPath, {force: true, recursive: true});
        }
    }
}

/**
 * Writes every manifest entry into an empty directory, applying its declared
 * transform.
 */
function writeOpenSourceRepositoryFiles({
    manifest,
    outputRepositoryPath,
}: Pick<PackageOpenSourcePublicationManifestArguments, "manifest" | "outputRepositoryPath">): void {
    for (const entry of manifest.entries) {
        const destinationPath = path.join(outputRepositoryPath, ...entry.outputPath.split("/"));
        fs.mkdirSync(path.dirname(destinationPath), {recursive: true});
        writeOpenSourceManifestEntry({destinationPath, entry});
        fs.chmodSync(destinationPath, fs.statSync(entry.inputPath).mode & 0o777);
    }
}

function writeOpenSourceManifestEntry({
    destinationPath,
    entry,
}: {
    destinationPath: string;
    entry: OpenSourcePublicationManifestEntry;
}): void {
    switch (entry.contentTransform.kind) {
        case "copy":
            writeOpenSourceManifestCopy({destinationPath, entry});
            return;
        case "patch-package":
            fs.writeFileSync(
                destinationPath,
                transformOpenSourcePnpmPatchForPatchPackage({
                    packageName: entry.contentTransform.packageName,
                    source: fs.readFileSync(entry.inputPath, "utf8"),
                }),
                {flag: "wx"},
            );
            return;
        default: {
            const exhaustiveContentTransform: never = entry.contentTransform;
            throw new Error(`Unknown open-source content transform: ${exhaustiveContentTransform}`);
        }
    }
}

function writeOpenSourceManifestCopy({
    destinationPath,
    entry,
}: {
    destinationPath: string;
    entry: OpenSourcePublicationManifestEntry;
}): void {
    if (isJavaScriptOrTypeScriptPath(entry.outputPath)) {
        fs.writeFileSync(
            destinationPath,
            stripOpenSourceTagsFromModuleReferences(
                fs.readFileSync(entry.inputPath, "utf8"),
                entry.sourceRelativePath,
            ),
            {flag: "wx"},
        );
    } else if (isJsonPath(entry.outputPath)) {
        fs.writeFileSync(
            destinationPath,
            stripOpenSourceTagsFromJsonReferences(fs.readFileSync(entry.inputPath, "utf8")),
            {flag: "wx"},
        );
    } else if (isYamlPath(entry.outputPath)) {
        fs.writeFileSync(
            destinationPath,
            stripOpenSourceTagsFromWorkflowReferences(fs.readFileSync(entry.inputPath, "utf8")),
            {flag: "wx"},
        );
    } else {
        fs.copyFileSync(entry.inputPath, destinationPath, fs.constants.COPYFILE_EXCL);
    }
}

/**
 * Converts pnpm patch headers from package-relative paths to patch-package's
 * `node_modules/<package>` paths. The changed-file bodies remain byte-for-byte
 * unchanged.
 */
function transformOpenSourcePnpmPatchForPatchPackage({
    packageName,
    source,
}: {
    packageName: string;
    source: string;
}): string {
    const nodeModulesPackagePath = `node_modules/${packageName}/`;
    return source
        .split("\n")
        .map(line => {
            if (line.startsWith("diff --git a/")) {
                return line
                    .replace("diff --git a/", `diff --git a/${nodeModulesPackagePath}`)
                    .replace(" b/", ` b/${nodeModulesPackagePath}`);
            }
            if (line.startsWith("--- a/")) {
                return line.replace("--- a/", `--- a/${nodeModulesPackagePath}`);
            }
            if (line.startsWith("+++ b/")) {
                return line.replace("+++ b/", `+++ b/${nodeModulesPackagePath}`);
            }
            return line;
        })
        .join("\n");
}

/**
 * Uses Bazel's `zipper` executable to archive the staging directory while
 * preserving executable file modes.
 */
function createOpenSourceArchive({
    archivePath,
    outputPaths,
    repositoryPath,
    zipperPath,
}: {
    archivePath: string;
    outputPaths: ReadonlyArray<string>;
    repositoryPath: string;
    zipperPath: string;
}): void {
    try {
        childProcess.execFileSync(zipperPath, ["cC", archivePath, ...outputPaths], {
            cwd: repositoryPath,
            stdio: "pipe",
        });
    } catch (error) {
        const detail =
            error && typeof error === "object" && "stderr" in error
                ? String(error.stderr).trim()
                : "";
        throw new Error(
            `Could not create open-source archive at ${archivePath}` +
                (detail ? `: ${detail}` : ""),
        );
    }
}

/**
 * Rewrites tagged paths in repository JSON such as the generated TypeScript
 * config.
 */
function stripOpenSourceTagsFromJsonReferences(source: string): string {
    return source
        .replaceAll(`${openSourceStubTag}.`, ".")
        .replaceAll(`${openSourceFileTag}.`, ".")
        .replaceAll(openSourceFileTag, "");
}

/** Rewrites local composite-action paths in public GitHub workflow files. */
function stripOpenSourceTagsFromWorkflowReferences(source: string): string {
    return source.replace(
        /^(\s*uses:\s*)(\.\/[^\s#]+)(\s*(?:#.*)?)$/gmu,
        (match, prefix, localPath, suffix) => {
            if (!isOpenSourceTaggedPath(localPath)) return match;
            return `${prefix}./${stripOpenSourceTagsFromPath(localPath.slice(2))}${suffix}`;
        },
    );
}

/** Rewrites only parsed JavaScript and TypeScript module references. */
function stripOpenSourceTagsFromModuleReferences(source: string, sourceFilePath: string): string {
    const sourceFile = ts.createSourceFile(sourceFilePath, source, ts.ScriptTarget.Latest, false);
    const referenceRanges: Array<{end: number; start: number}> = [];
    const referenceRangeKeys = new Set<string>();

    function addStringLiteralReference(node: ts.Node | undefined): void {
        if (!node || (!ts.isStringLiteral(node) && !ts.isNoSubstitutionTemplateLiteral(node))) {
            return;
        }
        const start = node.getStart(sourceFile) + 1;
        const end = node.end - 1;
        const key = `${start}:${end}`;
        if (source.slice(start, end).includes(openSourceFileTag) && !referenceRangeKeys.has(key)) {
            referenceRangeKeys.add(key);
            referenceRanges.push({end, start});
        }
    }

    function visit(node: ts.Node): void {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
            addStringLiteralReference(node.moduleSpecifier);
        } else if (
            ts.isImportEqualsDeclaration(node) &&
            ts.isExternalModuleReference(node.moduleReference)
        ) {
            addStringLiteralReference(node.moduleReference.expression);
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
            addStringLiteralReference(node.argument.literal);
        } else if (ts.isCallExpression(node) && isTypeScriptModuleLoader(node.expression)) {
            addStringLiteralReference(node.arguments[0]);
        } else if (
            ts.isNewExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === "URL" &&
            node.arguments !== undefined &&
            node.arguments.length >= 2 &&
            node.arguments[1] !== undefined &&
            isImportMetaUrl(node.arguments[1])
        ) {
            addStringLiteralReference(node.arguments[0]);
        } else if (ts.isStringLiteral(node) && isOpenSourcePathReference(node.text)) {
            addStringLiteralReference(node);
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    for (const reference of [
        ...sourceFile.referencedFiles,
        ...sourceFile.typeReferenceDirectives,
        ...sourceFile.libReferenceDirectives,
    ]) {
        if (source.slice(reference.pos, reference.end).includes(openSourceFileTag)) {
            referenceRanges.push({end: reference.end, start: reference.pos});
        }
    }

    let transformedSource = source;
    for (const {end, start} of referenceRanges.sort((left, right) => right.start - left.start)) {
        const reference = transformedSource.slice(start, end);
        transformedSource =
            transformedSource.slice(0, start) +
            reference
                .replaceAll(`${openSourceStubTag}.`, ".")
                .replaceAll(`${openSourceFileTag}.`, ".")
                .replaceAll(openSourceFileTag, "") +
            transformedSource.slice(end);
    }
    return transformedSource;
}

function isOpenSourcePathReference(value: string): boolean {
    return (
        value.includes("/") &&
        value.includes(openSourceFileTag) &&
        !value.includes("://") &&
        !/\s/u.test(value)
    );
}

function writeOpenSourceManifest(
    manifestOutputPath: string,
    manifest: OpenSourcePublicationManifest,
): void {
    const serializedManifest = {
        files: manifest.entries.map(entry => ({
            isTest: entry.isTest,
            outputKind: entry.outputKind,
            outputPath: entry.outputPath,
            selectionReasons: entry.selectionReasons,
            sourcePath: entry.sourceRelativePath,
        })),
        imports: manifest.importEdges,
    };
    fs.writeFileSync(manifestOutputPath, `${JSON.stringify(serializedManifest, null, 2)}\n`);
}

function isJavaScriptOrTypeScriptPath(filePath: string): boolean {
    return /\.[cm]?[jt]sx?$/u.test(filePath);
}

function isJsonPath(filePath: string): boolean {
    return filePath.endsWith(".json");
}

function isYamlPath(filePath: string): boolean {
    return /\.ya?ml$/u.test(filePath);
}

function isTypeScriptModuleLoader(expression: ts.Expression): boolean {
    return (
        expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(expression) && expression.text === "require") ||
        (ts.isPropertyAccessExpression(expression) &&
            ts.isIdentifier(expression.expression) &&
            expression.expression.text === "require" &&
            expression.name.text === "resolve")
    );
}

function isImportMetaUrl(node: ts.Node): boolean {
    return (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === "url" &&
        ts.isMetaProperty(node.expression) &&
        node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
        node.expression.name.text === "meta"
    );
}

export {
    archiveOpenSourcePublicationManifest,
    packageOpenSourcePublicationManifest,
    stripOpenSourceTagsFromModuleReferences,
    stripOpenSourceTagsFromWorkflowReferences,
};
