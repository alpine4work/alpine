/* eslint-disable cyberworlds/no-global-error -- Archive extraction errors retain native detail. */

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import {
    replaceOpenSourceRepositoryContents,
    resolveSafeOpenSourceOutput,
} from "~/admin/open_source/internal/replace_open_source_repository.js";

const localResultRelativePath = "admin/open_source/result";

/**
 * Unpacks Bazel's public ZIP into the ignored local result directory for
 * inspection.
 */
function main() {
    const [archivePath, ...unexpectedArgs] = process.argv.slice(2);
    if (!archivePath || unexpectedArgs.length > 0) {
        throw new Error(
            "Usage: bazel run //admin/open_source:publish_open_source_repository\n" +
                `Writes the generated repository to ${localResultRelativePath}.`,
        );
    }

    const workspacePath = process.env.BUILD_WORKSPACE_DIRECTORY;
    if (!workspacePath) {
        throw new Error("Expected BUILD_WORKSPACE_DIRECTORY while publishing the local result");
    }
    const outputRepositoryPath = path.join(workspacePath, ...localResultRelativePath.split("/"));
    const safeOutput = resolveSafeOpenSourceOutput({
        buildOutputRootPath: undefined,
        outputRepositoryPath,
        workspacePath,
    });
    if (safeOutput.createOutputRepository) {
        fs.mkdirSync(safeOutput.outputRepositoryPath, {recursive: true});
    }

    const outputParentPath = path.dirname(safeOutput.outputRepositoryPath);
    const outputName = path.basename(safeOutput.outputRepositoryPath);
    const stagingPath = fs.mkdtempSync(path.join(outputParentPath, `.${outputName}.archive-`));
    const backupPath = fs.mkdtempSync(path.join(outputParentPath, `.${outputName}.backup-`));
    let preserveBackup = false;

    try {
        childProcess.execFileSync("unzip", ["-q", path.resolve(archivePath), "-d", stagingPath], {
            stdio: "inherit",
        });
        const replacementResult = replaceOpenSourceRepositoryContents({
            backupPath,
            outputRepositoryPath: safeOutput.outputRepositoryPath,
            stagingPath,
        });
        preserveBackup = !replacementResult.ok && replacementResult.preserveBackup;
        if (!replacementResult.ok) throw replacementResult.error;
    } finally {
        fs.rmSync(stagingPath, {force: true, recursive: true});
        if (!preserveBackup) fs.rmSync(backupPath, {force: true, recursive: true});
    }
}

main();
