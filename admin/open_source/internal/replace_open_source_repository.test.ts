/* eslint-disable cyberworlds/no-global-error -- Tests inject ordinary failures into rollback hooks. */

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
    createTemporaryDirectory,
    writeFile,
} from "~/admin/open_source/internal/open_source_test_helpers.js";

import {
    replaceOpenSourceRepositoryContents,
    resolveSafeOpenSourceOutput,
} from "~/admin/open_source/internal/replace_open_source_repository.js";

test("rolls back a failed replacement", () => {
    const fixturePath = createTemporaryDirectory();
    const outputRepositoryPath = path.join(fixturePath, "output");
    const stagingPath = path.join(fixturePath, "staging");
    const backupPath = path.join(fixturePath, "backup");
    fs.mkdirSync(outputRepositoryPath);
    fs.mkdirSync(stagingPath);
    fs.mkdirSync(backupPath);
    writeFile(outputRepositoryPath, "old.txt", "old\n");
    writeFile(stagingPath, "new.txt", "new\n");

    const result = replaceOpenSourceRepositoryContents({
        backupPath,
        outputRepositoryPath,
        renameEntry(sourcePath, destinationPath) {
            if (sourcePath === path.join(stagingPath, "new.txt")) {
                throw new Error("replacement blocked");
            }
            fs.renameSync(sourcePath, destinationPath);
        },
        stagingPath,
    });

    assert.equal(result.ok, false);
    assert.equal(result.preserveBackup, false);
    assert.equal(fs.readFileSync(path.join(outputRepositoryPath, "old.txt"), "utf8"), "old\n");
});

test("preserves the backup when replacement rollback is incomplete", () => {
    const fixturePath = createTemporaryDirectory();
    const outputRepositoryPath = path.join(fixturePath, "output");
    const stagingPath = path.join(fixturePath, "staging");
    const backupPath = path.join(fixturePath, "backup");
    fs.mkdirSync(outputRepositoryPath);
    fs.mkdirSync(stagingPath);
    fs.mkdirSync(backupPath);
    writeFile(outputRepositoryPath, "old.txt", "old\n");
    writeFile(stagingPath, "a-new.txt", "new\n");
    writeFile(stagingPath, "z-fail.txt", "fail\n");

    const result = replaceOpenSourceRepositoryContents({
        backupPath,
        outputRepositoryPath,
        renameEntry(sourcePath, destinationPath) {
            if (sourcePath === path.join(stagingPath, "z-fail.txt")) {
                throw new Error("replacement blocked");
            }
            if (sourcePath === path.join(outputRepositoryPath, "a-new.txt")) {
                throw new Error("rollback blocked");
            }
            if (sourcePath === path.join(backupPath, "old.txt")) {
                throw new Error("restore blocked");
            }
            fs.renameSync(sourcePath, destinationPath);
        },
        stagingPath,
    });

    assert.equal(result.ok, false);
    if (result.ok) throw new Error("Expected replacement to fail");
    assert.equal(result.preserveBackup, true);
    assert.match(String(result.error), /backup directory remains/);
    assert.equal(fs.readFileSync(path.join(backupPath, "old.txt"), "utf8"), "old\n");
});

test("rejects output paths that overlap the private workspace through a symlink", () => {
    const fixturePath = createTemporaryDirectory();
    const workspacePath = path.join(fixturePath, "workspace");
    fs.mkdirSync(workspacePath);
    const workspaceAliasPath = path.join(fixturePath, "workspace-alias");
    fs.symlinkSync(workspacePath, workspaceAliasPath, "dir");

    assert.throws(
        () =>
            resolveSafeOpenSourceOutput({
                outputRepositoryPath: path.join(workspaceAliasPath, "nested"),
                workspacePath,
            }),
        /overlapping open-source input and output paths/,
    );
});
