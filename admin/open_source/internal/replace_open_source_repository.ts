/* eslint-disable cyberworlds/no-global-error -- Filesystem errors retain the operating-system message. */

import * as fs from "node:fs";
import * as path from "node:path";

const localResultRelativePath = "admin/open_source/result";

/** Filesystem rename primitive injected by rollback tests. */
export type OpenSourceRenameEntry = (sourcePath: string, destinationPath: string) => void;

/** Result of replacing a repository while preserving its `.git` directory. */
export type OpenSourceRepositoryReplacementResult =
    | Readonly<{
          ok: true;
          preserveBackup: false;
      }>
    | Readonly<{
          error: unknown;
          ok: false;
          preserveBackup: boolean;
      }>;

/**
 * Resolves symlinks and allows only the local result, Bazel output, or an existing
 * Git checkout.
 */
function resolveSafeOpenSourceOutput({
    buildOutputRootPath,
    outputRepositoryPath,
    workspacePath,
}: {
    buildOutputRootPath?: string;
    outputRepositoryPath: string;
    workspacePath: string;
}): {createOutputRepository: boolean; outputRepositoryPath: string} {
    const canonicalWorkspacePath = fs.realpathSync(workspacePath);
    const canonicalOutputRepositoryPath = resolveRealPathWithMissingSegments(outputRepositoryPath);
    const canonicalLocalResultPath = path.join(
        canonicalWorkspacePath,
        ...localResultRelativePath.split("/"),
    );
    const canonicalBuildOutputRootPath = buildOutputRootPath
        ? fs.realpathSync(buildOutputRootPath)
        : undefined;
    const isLocalResultRepository = canonicalOutputRepositoryPath === canonicalLocalResultPath;
    const isBazelBuildOutput =
        canonicalBuildOutputRootPath !== undefined &&
        canonicalOutputRepositoryPath !== canonicalBuildOutputRootPath &&
        samePathOrChild(canonicalOutputRepositoryPath, canonicalBuildOutputRootPath);

    if (canonicalOutputRepositoryPath === path.parse(canonicalOutputRepositoryPath).root) {
        throw new Error(`Refusing to replace filesystem root: ${canonicalOutputRepositoryPath}`);
    }
    if (!isLocalResultRepository && !isBazelBuildOutput) {
        if (
            samePathOrChild(canonicalOutputRepositoryPath, canonicalWorkspacePath) ||
            samePathOrChild(canonicalWorkspacePath, canonicalOutputRepositoryPath)
        ) {
            throw new Error(
                `Refusing overlapping open-source input and output paths: ` +
                    `${canonicalWorkspacePath}, ${canonicalOutputRepositoryPath}`,
            );
        }
        assertDirectory(canonicalOutputRepositoryPath, "Open-source output repository");
        if (!fs.existsSync(path.join(canonicalOutputRepositoryPath, ".git"))) {
            throw new Error(
                `Refusing to replace ${canonicalOutputRepositoryPath}: ` +
                    "expected an existing Git checkout with `.git`",
            );
        }
    } else if (fs.existsSync(canonicalOutputRepositoryPath)) {
        assertDirectory(canonicalOutputRepositoryPath, "Local open-source result directory");
    }

    return {
        createOutputRepository:
            (isLocalResultRepository || isBazelBuildOutput) &&
            !fs.existsSync(canonicalOutputRepositoryPath),
        outputRepositoryPath: canonicalOutputRepositoryPath,
    };
}

/**
 * Moves old files to the backup, moves staged files into place, and restores the
 * old files if either move fails. The `.git` directory stays in place.
 */
function replaceOpenSourceRepositoryContents({
    backupPath,
    outputRepositoryPath,
    renameEntry = fs.renameSync,
    stagingPath,
}: {
    backupPath: string;
    outputRepositoryPath: string;
    renameEntry?: OpenSourceRenameEntry;
    stagingPath: string;
}): OpenSourceRepositoryReplacementResult {
    const movedOldEntries: Array<string> = [];
    const movedNewEntries: Array<string> = [];
    try {
        for (const entryName of fs.readdirSync(outputRepositoryPath).sort()) {
            if (entryName === ".git") continue;
            renameEntry(
                path.join(outputRepositoryPath, entryName),
                path.join(backupPath, entryName),
            );
            movedOldEntries.push(entryName);
        }
        for (const entryName of fs.readdirSync(stagingPath).sort()) {
            renameEntry(
                path.join(stagingPath, entryName),
                path.join(outputRepositoryPath, entryName),
            );
            movedNewEntries.push(entryName);
        }
    } catch (error) {
        const rollbackErrors: Array<unknown> = [];
        for (const entryName of movedNewEntries.reverse()) {
            try {
                renameEntry(
                    path.join(outputRepositoryPath, entryName),
                    path.join(stagingPath, entryName),
                );
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
        }
        for (const entryName of movedOldEntries.reverse()) {
            try {
                renameEntry(
                    path.join(backupPath, entryName),
                    path.join(outputRepositoryPath, entryName),
                );
            } catch (rollbackError) {
                rollbackErrors.push(rollbackError);
            }
        }
        if (rollbackErrors.length > 0) {
            return {
                error: replacementRollbackError({backupPath, error, rollbackErrors}),
                ok: false,
                preserveBackup: true,
            };
        }
        return {error, ok: false, preserveBackup: false};
    }
    return {ok: true, preserveBackup: false};
}

function resolveRealPathWithMissingSegments(filePath: string): string {
    let existingAncestorPath = path.resolve(filePath);
    const missingPathSegments: Array<string> = [];
    while (!pathEntryExists(existingAncestorPath)) {
        const parentPath = path.dirname(existingAncestorPath);
        if (parentPath === existingAncestorPath) {
            throw new Error(`Could not resolve an existing ancestor for ${filePath}`);
        }
        missingPathSegments.unshift(path.basename(existingAncestorPath));
        existingAncestorPath = parentPath;
    }
    return path.resolve(fs.realpathSync(existingAncestorPath), ...missingPathSegments);
}

function pathEntryExists(filePath: string): boolean {
    try {
        fs.lstatSync(filePath);
        return true;
    } catch (error) {
        if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            (error.code === "ENOENT" || error.code === "ENOTDIR")
        ) {
            return false;
        }
        throw error;
    }
}

function samePathOrChild(childPath: string, parentPath: string): boolean {
    const relativePath = path.relative(path.resolve(parentPath), path.resolve(childPath));
    return (
        relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath))
    );
}

function assertDirectory(directoryPath: string, description: string): void {
    let stats: fs.Stats;
    try {
        stats = fs.lstatSync(directoryPath);
    } catch (error) {
        if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            error.code === "ENOENT"
        ) {
            throw new Error(`${description} does not exist: ${directoryPath}`);
        }
        throw error;
    }
    if (!stats.isDirectory()) {
        throw new Error(`${description} is not a directory: ${directoryPath}`);
    }
}

function replacementRollbackError({
    backupPath,
    error,
    rollbackErrors,
}: {
    backupPath: string;
    error: unknown;
    rollbackErrors: ReadonlyArray<unknown>;
}): Error {
    const rollbackDetails = rollbackErrors
        .map(rollbackError => `  - ${errorMessage(rollbackError)}`)
        .join("\n");
    return new Error(`Open-source repository replacement failed: ${errorMessage(error)}
Rollback was incomplete. The backup directory remains at ${backupPath}.
Rollback errors:
${rollbackDetails}`);
}

function errorMessage(error: unknown): string {
    return error instanceof Error ? error.message : String(error);
}

export {replaceOpenSourceRepositoryContents, resolveSafeOpenSourceOutput};
