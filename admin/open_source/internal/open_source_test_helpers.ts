/* eslint-disable cyberworlds/no-global-error -- Child-process failures need their captured output. */

import * as childProcess from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const temporaryDirectories: Array<string> = [];

afterEach(() => {
    for (const temporaryDirectory of temporaryDirectories.splice(0)) {
        fs.rmSync(temporaryDirectory, {force: true, recursive: true});
    }
});

function createTemporaryDirectory(): string {
    const temporaryDirectoryRootPath = process.env.TEST_TMPDIR ?? os.tmpdir();
    const directoryPath = fs.mkdtempSync(
        path.join(temporaryDirectoryRootPath, "open-source-test-"),
    );
    temporaryDirectories.push(directoryPath);
    return directoryPath;
}

function createWorkspaceFixture(): {outputRepositoryPath: string; workspacePath: string} {
    const fixturePath = createTemporaryDirectory();
    const workspacePath = path.join(fixturePath, "workspace");
    const outputRepositoryPath = path.join(fixturePath, "output");
    fs.mkdirSync(path.join(outputRepositoryPath, ".git"), {recursive: true});
    writeFile(workspacePath, "BUILD", "");
    writeFile(workspacePath, "server/agents/cli/BUILD", "");
    writeFile(
        workspacePath,
        "server/agents/cli/cli_main.open_source.ts",
        "export const cli = true;\n",
    );
    writeFile(
        workspacePath,
        "server/agents/cli/cli_tracer_background_main.open_source.ts",
        "export const background = true;\n",
    );
    writeFile(workspacePath, "package.open_source.json", `${JSON.stringify({type: "module"})}\n`);
    runGit(workspacePath, ["init", "--quiet"]);
    return {outputRepositoryPath, workspacePath};
}

function writeFile(rootPath: string, relativePath: string, content: string): string {
    const filePath = path.join(rootPath, ...relativePath.split("/"));
    fs.mkdirSync(path.dirname(filePath), {recursive: true});
    fs.writeFileSync(filePath, content);
    return filePath;
}

function runGit(workspacePath: string, args: ReadonlyArray<string>): void {
    const result = childProcess.spawnSync("git", args, {cwd: workspacePath, encoding: "utf8"});
    if (result.status !== 0) throw new Error(result.stderr || result.stdout);
}

function listFiles(directoryPath: string): Array<string> {
    const files: Array<string> = [];
    function visit(currentPath: string): void {
        for (const entry of fs
            .readdirSync(currentPath, {withFileTypes: true})
            .sort((left, right) => left.name.localeCompare(right.name))) {
            const entryPath = path.join(currentPath, entry.name);
            if (entry.isDirectory()) visit(entryPath);
            else files.push(path.relative(directoryPath, entryPath).split(path.sep).join("/"));
        }
    }
    visit(directoryPath);
    return files;
}

export {createTemporaryDirectory, createWorkspaceFixture, listFiles, runGit, writeFile};
