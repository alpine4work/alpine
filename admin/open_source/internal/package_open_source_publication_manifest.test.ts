/* eslint-disable cyberworlds/string-quotes -- Fixtures contain JavaScript source text. */

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
    type OpenSourceOutputKind,
    type OpenSourcePublicationManifest,
    type OpenSourcePublicationManifestEntry,
    type OpenSourcePublicationManifestEntryContentTransform,
} from "~/admin/open_source/internal/collect_open_source_publication_manifest.js";
import {
    createTemporaryDirectory,
    listFiles,
    writeFile,
} from "~/admin/open_source/internal/open_source_test_helpers.js";

import {
    packageOpenSourcePublicationManifest,
    stripOpenSourceTagsFromWorkflowReferences,
} from "~/admin/open_source/internal/package_open_source_publication_manifest.js";

test("packages static files at root and transformed workspace files at workspace-relative paths", () => {
    const workspacePath = createTemporaryDirectory();
    const outputRepositoryPath = path.join(workspacePath, "admin", "open_source", "result");
    const manifestOutputPath = path.join(createTemporaryDirectory(), "manifest.json");
    const readmePath = writeFile(workspacePath, "README.open_source.md", "# Community\n");
    const sourcePath = writeFile(
        workspacePath,
        "shared/value.open_source.test.ts",
        'import {dependency} from "./dependency.open_source.js";\n' +
            'const asset = new URL("./asset.open_source.js", import.meta.url, undefined);\n' +
            "export {asset, dependency};\n",
    );
    const dependencyPath = writeFile(
        workspacePath,
        "shared/dependency.open_source.ts",
        "export const dependency = true;\n",
    );
    const repositoryScriptPath = writeFile(
        workspacePath,
        "scripts/main.open_source.mjs",
        'import "./helper.open_source.mjs";\n' +
            'const entryPoint = "server/agents/cli/cli_main.open_source.ts";\n',
    );
    const workflowPath = writeFile(
        workspacePath,
        ".open_source.github/workflows/test_and_deploy.yaml",
        "jobs:\n    publish:\n        uses: ./.open_source.github/actions/test # public CI\n",
    );
    const manifest: OpenSourcePublicationManifest = {
        entries: [
            entry(readmePath, "README.open_source.md", "README.md", {
                outputKind: "repository",
            }),
            entry(repositoryScriptPath, "scripts/main.open_source.mjs", "scripts/main.mjs", {
                outputKind: "repository",
            }),
            entry(
                workflowPath,
                ".open_source.github/workflows/test_and_deploy.yaml",
                ".github/workflows/test_and_deploy.yaml",
                {outputKind: "repository"},
            ),
            entry(dependencyPath, "shared/dependency.open_source.ts", "shared/dependency.ts"),
            entry(sourcePath, "shared/value.open_source.test.ts", "shared/value.test.ts", {
                isTest: true,
            }),
        ],
        importEdges: [],
    };

    packageOpenSourcePublicationManifest({
        manifest,
        manifestOutputPath,
        outputRepositoryPath,
        workspacePath,
    });

    assert.deepEqual(listFiles(outputRepositoryPath), [
        ".github/workflows/test_and_deploy.yaml",
        "README.md",
        "scripts/main.mjs",
        "shared/dependency.ts",
        "shared/value.test.ts",
    ]);
    assert.equal(
        fs.readFileSync(path.join(outputRepositoryPath, "scripts/main.mjs"), "utf8"),
        'import "./helper.mjs";\nconst entryPoint = "server/agents/cli/cli_main.ts";\n',
    );
    assert.equal(
        fs.readFileSync(
            path.join(outputRepositoryPath, ".github/workflows/test_and_deploy.yaml"),
            "utf8",
        ),
        "jobs:\n    publish:\n        uses: ./.github/actions/test # public CI\n",
    );
    assert.equal(
        fs.readFileSync(path.join(outputRepositoryPath, "shared/value.test.ts"), "utf8"),
        'import {dependency} from "./dependency.js";\n' +
            'const asset = new URL("./asset.js", import.meta.url, undefined);\n' +
            "export {asset, dependency};\n",
    );
    const writtenManifest = JSON.parse(fs.readFileSync(manifestOutputPath, "utf8")) as {
        files: Array<{outputPath: string}>;
    };
    assert.deepEqual(
        writtenManifest.files.map(file => file.outputPath),
        [
            "README.md",
            "scripts/main.mjs",
            ".github/workflows/test_and_deploy.yaml",
            "shared/dependency.ts",
            "shared/value.test.ts",
        ],
    );
});

test("replaces stale worktree files while preserving git history", () => {
    const fixturePath = createTemporaryDirectory();
    const workspacePath = path.join(fixturePath, "workspace");
    const outputRepositoryPath = path.join(fixturePath, "output");
    fs.mkdirSync(path.join(outputRepositoryPath, ".git"), {recursive: true});
    writeFile(outputRepositoryPath, ".git/config", "history\n");
    writeFile(outputRepositoryPath, "stale.txt", "stale\n");
    const readmePath = writeFile(workspacePath, "README.open_source.md", "new\n");
    const manifest: OpenSourcePublicationManifest = {
        entries: [
            entry(readmePath, "README.open_source.md", "README.md", {
                outputKind: "repository",
            }),
        ],
        importEdges: [],
    };

    packageOpenSourcePublicationManifest({manifest, outputRepositoryPath, workspacePath});

    assert.deepEqual(listFiles(outputRepositoryPath), [".git/config", "README.md"]);
    assert.equal(
        fs.readFileSync(path.join(outputRepositoryPath, ".git/config"), "utf8"),
        "history\n",
    );
});

test("converts pnpm patches to patch-package paths", () => {
    const workspacePath = createTemporaryDirectory();
    const outputRepositoryPath = path.join(workspacePath, "admin", "open_source", "result");
    const patchPath = writeFile(
        workspacePath,
        "admin/patches/example@1.0.0.patch",
        "diff --git a/index.js b/index.js\n" +
            "index 0000000..1111111 100644\n" +
            "--- a/index.js\n" +
            "+++ b/index.js\n" +
            "@@ -1 +1 @@\n" +
            "-before\n" +
            "+after\n",
    );
    const manifest: OpenSourcePublicationManifest = {
        entries: [
            entry(
                patchPath,
                "packages/cli/patches.open_source/example+1.0.0.dev.patch",
                "packages/cli/patches/example+1.0.0.dev.patch",
                {
                    contentTransform: {kind: "patch-package", packageName: "example"},
                    outputKind: "repository",
                },
            ),
        ],
        importEdges: [],
    };

    packageOpenSourcePublicationManifest({manifest, outputRepositoryPath, workspacePath});

    assert.equal(
        fs.readFileSync(
            path.join(outputRepositoryPath, "packages/cli/patches/example+1.0.0.dev.patch"),
            "utf8",
        ),
        "diff --git a/node_modules/example/index.js b/node_modules/example/index.js\n" +
            "index 0000000..1111111 100644\n" +
            "--- a/node_modules/example/index.js\n" +
            "+++ b/node_modules/example/index.js\n" +
            "@@ -1 +1 @@\n" +
            "-before\n" +
            "+after\n",
    );
});

function entry(
    inputPath: string,
    sourceRelativePath: string,
    outputPath: string,
    {
        contentTransform = {kind: "copy"},
        isTest = false,
        outputKind = "source",
    }: {
        contentTransform?: OpenSourcePublicationManifestEntryContentTransform;
        isTest?: boolean;
        outputKind?: OpenSourceOutputKind;
    } = {},
): OpenSourcePublicationManifestEntry {
    return {
        contentTransform,
        inputPath,
        isTest,
        outputKind,
        outputPath,
        selectionReasons: ["test fixture"],
        sourceRelativePath,
    };
}

test("strips tags from local workflow action references", () => {
    assert.equal(
        stripOpenSourceTagsFromWorkflowReferences("uses: ./.open_source.github/actions/test\n"),
        "uses: ./.github/actions/test\n",
    );
    assert.equal(
        stripOpenSourceTagsFromWorkflowReferences("uses: actions/checkout@v6\n"),
        "uses: actions/checkout@v6\n",
    );
});
