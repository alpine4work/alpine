import * as assert from "node:assert/strict";
import * as path from "node:path";
import {
    type OpenSourceOutputKind,
    type OpenSourcePublicationManifest,
    type OpenSourcePublicationManifestEntry,
} from "~/admin/open_source/internal/collect_open_source_publication_manifest.js";
import {
    createTemporaryDirectory,
    writeFile,
} from "~/admin/open_source/internal/open_source_test_helpers.js";

import {validateOpenSourcePublicationManifest} from "~/admin/open_source/internal/validate_open_source_publication_manifest.js";

test("accepts selected imports and declared public packages", () => {
    const workspacePath = createTemporaryDirectory();
    writeFile(workspacePath, "BUILD", "");
    writeFile(workspacePath, "shared/BUILD", "");
    const sourcePath = writeFile(workspacePath, "shared/value.ts", "export const value = 1;\n");
    const testPath = writeFile(
        workspacePath,
        "shared/value.test.ts",
        "export const test = true;\n",
    );
    const packagePath = writeFile(
        workspacePath,
        "public/package.json",
        `${JSON.stringify({dependencies: {chalk: "1.0.0"}})}\n`,
    );
    const manifest: OpenSourcePublicationManifest = {
        entries: [
            entry(packagePath, "public/package.open_source.json", "package.json", {
                outputKind: "repository",
            }),
            entry(testPath, "shared/value.open_source.test.ts", "shared/value.test.ts", {
                isTest: true,
            }),
            entry(sourcePath, "shared/value.open_source.ts", "shared/value.ts"),
        ],
        importEdges: [
            {
                fromOutputPath: "shared/value.test.ts",
                fromSourcePath: "shared/value.open_source.test.ts",
                kind: "workspace",
                moduleSpecifier: "./value.js",
                toOutputPath: "shared/value.ts",
            },
            {
                fromOutputPath: "shared/value.ts",
                fromSourcePath: "shared/value.open_source.ts",
                kind: "bare",
                moduleSpecifier: "chalk/source",
            },
        ],
    };

    assert.doesNotThrow(() =>
        validateOpenSourcePublicationManifest({
            allowedBazelPackages: new Set(["//", "//shared"]),
            manifest,
            workspacePath,
        }),
    );
});

test("accepts module names supplied by declared DefinitelyTyped packages", () => {
    const workspacePath = createTemporaryDirectory();
    writeFile(workspacePath, "BUILD", "");
    writeFile(workspacePath, "shared/BUILD", "");
    const testPath = writeFile(workspacePath, "shared/value.test.ts", "export {};\n");
    const packagePath = writeFile(
        workspacePath,
        "public/package.json",
        `${JSON.stringify({devDependencies: {"@types/mdast": "1.0.0"}})}\n`,
    );
    const manifest: OpenSourcePublicationManifest = {
        entries: [
            entry(packagePath, "public/package.open_source.json", "package.json", {
                outputKind: "repository",
            }),
            entry(testPath, "shared/value.open_source.test.ts", "shared/value.test.ts", {
                isTest: true,
            }),
        ],
        importEdges: [
            {
                fromOutputPath: "shared/value.test.ts",
                fromSourcePath: "shared/value.open_source.test.ts",
                kind: "bare",
                moduleSpecifier: "mdast",
            },
        ],
    };

    assert.doesNotThrow(() =>
        validateOpenSourcePublicationManifest({
            allowedBazelPackages: new Set(["//", "//shared"]),
            manifest,
            workspacePath,
        }),
    );
});

test("rejects an untagged published file", () => {
    const workspacePath = createTemporaryDirectory();
    writeFile(workspacePath, "BUILD", "");
    const sourcePath = writeFile(workspacePath, "shared/value.ts", "export {};");
    const manifest: OpenSourcePublicationManifest = {
        entries: [entry(sourcePath, "shared/value.ts", "shared/value.ts")],
        importEdges: [],
    };

    assert.throws(
        () =>
            validateOpenSourcePublicationManifest({
                allowedBazelPackages: new Set(["//"]),
                manifest,
                workspacePath,
            }),
        /refused untagged file: shared\/value\.ts.*Every published file must include `\.open_source`/,
    );
});

test("rejects an undeclared public package import", () => {
    const workspacePath = createTemporaryDirectory();
    writeFile(workspacePath, "BUILD", "");
    writeFile(workspacePath, "shared/BUILD", "");
    const testPath = writeFile(workspacePath, "shared/value.test.ts", "export {};\n");
    const manifest: OpenSourcePublicationManifest = {
        entries: [
            entry(testPath, "shared/value.open_source.test.ts", "shared/value.test.ts", {
                isTest: true,
            }),
        ],
        importEdges: [
            {
                fromOutputPath: "shared/value.test.ts",
                fromSourcePath: "shared/value.open_source.test.ts",
                kind: "bare",
                moduleSpecifier: "missing-package/subpath",
            },
        ],
    };

    assert.throws(
        () =>
            validateOpenSourcePublicationManifest({
                allowedBazelPackages: new Set(["//shared"]),
                manifest,
                workspacePath,
            }),
        /imports undeclared public package `missing-package\/subpath`/,
    );
});

test("rejects an import that is outside the fixed publication manifest", () => {
    const workspacePath = createTemporaryDirectory();
    writeFile(workspacePath, "BUILD", "");
    writeFile(workspacePath, "shared/BUILD", "");
    const testPath = writeFile(
        workspacePath,
        "shared/value.test.ts",
        "export const test = true;\n",
    );
    const manifest: OpenSourcePublicationManifest = {
        entries: [
            entry(testPath, "shared/value.open_source.test.ts", "shared/value.test.ts", {
                isTest: true,
            }),
        ],
        importEdges: [
            {
                fromOutputPath: "shared/value.test.ts",
                fromSourcePath: "shared/value.open_source.test.ts",
                kind: "workspace",
                moduleSpecifier: "./private.js",
                toOutputPath: "shared/private.ts",
            },
        ],
    };

    assert.throws(
        () =>
            validateOpenSourcePublicationManifest({
                allowedBazelPackages: new Set(["//shared"]),
                manifest,
                workspacePath,
            }),
        /private\.js.*not selected for open source/,
    );
});

test("rejects an import of a stub filename instead of its canonical path", () => {
    const workspacePath = createTemporaryDirectory();
    writeFile(workspacePath, "BUILD", "");
    writeFile(workspacePath, "shared/BUILD", "");
    const testPath = writeFile(
        workspacePath,
        "shared/value.test.ts",
        "export const test = true;\n",
    );
    const stubPath = writeFile(workspacePath, "shared/value.ts", "export const value = true;\n");
    const manifest: OpenSourcePublicationManifest = {
        entries: [
            entry(testPath, "shared/value.open_source.test.ts", "shared/value.test.ts", {
                isTest: true,
            }),
            entry(stubPath, "shared/value.open_source.stub.ts", "shared/value.ts", {
                outputKind: "stub",
            }),
        ],
        importEdges: [
            {
                fromOutputPath: "shared/value.test.ts",
                fromSourcePath: "shared/value.open_source.test.ts",
                kind: "workspace",
                moduleSpecifier: "./value.open_source.stub.js",
                toOutputPath: "shared/value.ts",
            },
        ],
    };

    assert.throws(
        () =>
            validateOpenSourcePublicationManifest({
                allowedBazelPackages: new Set(["//shared"]),
                manifest,
                workspacePath,
            }),
        /imports stub path.*canonical untagged path/,
    );
});

test("rejects workspace sources from every admin directory", () => {
    const workspacePath = createTemporaryDirectory();
    writeFile(workspacePath, "BUILD", "");
    writeFile(workspacePath, "admin/internal/BUILD", "");
    const privatePath = writeFile(
        workspacePath,
        "admin/internal/private.open_source.test.ts",
        "export const value = 1;\n",
    );
    const manifest: OpenSourcePublicationManifest = {
        entries: [
            entry(
                privatePath,
                "admin/internal/private.open_source.test.ts",
                "admin/internal/private.test.ts",
                {isTest: true},
            ),
        ],
        importEdges: [],
    };

    assert.throws(
        () =>
            validateOpenSourcePublicationManifest({
                allowedBazelPackages: new Set(["//admin/internal"]),
                manifest,
                workspacePath,
            }),
        /refused private file/,
    );
});

test("reports every package that still needs central approval", () => {
    const workspacePath = createTemporaryDirectory();
    writeFile(workspacePath, "BUILD", "");
    writeFile(workspacePath, "one/BUILD", "");
    writeFile(workspacePath, "two/BUILD", "");
    const onePath = writeFile(workspacePath, "one/value.test.ts", "export {};\n");
    const twoPath = writeFile(workspacePath, "two/value.ts", "export {};\n");
    const manifest: OpenSourcePublicationManifest = {
        entries: [
            entry(onePath, "one/value.open_source.test.ts", "one/value.test.ts", {isTest: true}),
            entry(twoPath, "two/value.open_source.ts", "two/value.ts"),
        ],
        importEdges: [],
    };

    assert.throws(
        () =>
            validateOpenSourcePublicationManifest({
                allowedBazelPackages: new Set(),
                manifest,
                workspacePath,
            }),
        error => {
            if (!(error instanceof Error)) return false;
            assert.match(error.message, /\/\/one/);
            assert.match(error.message, /\/\/two/);
            assert.match(error.message, /allowed_bazel_packages/);
            return true;
        },
    );
});

test("rejects a tagged file from a package missing central approval", () => {
    const workspacePath = createTemporaryDirectory();
    writeFile(workspacePath, "BUILD", "");
    writeFile(workspacePath, "unapproved/BUILD", "");
    const taggedPath = writeFile(
        workspacePath,
        "unapproved/value.open_source.test.ts",
        "export {};\n",
    );
    const manifest: OpenSourcePublicationManifest = {
        entries: [
            entry(taggedPath, "unapproved/value.open_source.test.ts", "unapproved/value.test.ts", {
                isTest: true,
            }),
        ],
        importEdges: [],
    };

    assert.throws(
        () =>
            validateOpenSourcePublicationManifest({
                allowedBazelPackages: new Set(["//", "//shared/helpers"]),
                manifest,
                workspacePath,
            }),
        error => {
            if (!(error instanceof Error)) return false;
            assert.match(
                error.message,
                /unapproved\/value\.open_source\.test\.ts \(\/\/unapproved;/,
            );
            assert.match(error.message, /add these package labels/);
            return true;
        },
    );
});

test("applies the central package allowlist to repository files", () => {
    const workspacePath = createTemporaryDirectory();
    writeFile(workspacePath, "BUILD", "");
    writeFile(workspacePath, "shared/BUILD", "");
    const readmePath = writeFile(workspacePath, "README.open_source.md", "public\n");
    const testPath = writeFile(workspacePath, "shared/value.test.ts", "export {};\n");
    const manifest: OpenSourcePublicationManifest = {
        entries: [
            entry(readmePath, "README.open_source.md", "README.md", {
                outputKind: "repository",
            }),
            entry(testPath, "shared/value.open_source.test.ts", "shared/value.test.ts", {
                isTest: true,
            }),
        ],
        importEdges: [],
    };

    assert.throws(
        () =>
            validateOpenSourcePublicationManifest({
                allowedBazelPackages: new Set(["//shared"]),
                manifest,
                workspacePath,
            }),
        /README\.open_source\.md \(\/\/;/,
    );
});

test("rejects tagged paths that map to the same public output", () => {
    const workspacePath = createTemporaryDirectory();
    writeFile(workspacePath, "BUILD", "");
    writeFile(workspacePath, "shared/BUILD", "");
    const firstReadmePath = writeFile(workspacePath, "README.open_source.md", "first\n");
    const secondReadmePath = writeFile(workspacePath, "README.md.open_source", "second\n");
    const testPath = writeFile(workspacePath, "shared/value.test.ts", "export {};\n");
    const manifest: OpenSourcePublicationManifest = {
        entries: [
            entry(firstReadmePath, "README.open_source.md", "README.md", {
                outputKind: "repository",
            }),
            entry(secondReadmePath, "README.md.open_source", "README.md", {
                outputKind: "repository",
            }),
            entry(testPath, "shared/value.open_source.test.ts", "shared/value.test.ts", {
                isTest: true,
            }),
        ],
        importEdges: [],
    };

    assert.throws(
        () =>
            validateOpenSourcePublicationManifest({
                allowedBazelPackages: new Set(["//", "//shared"]),
                manifest,
                workspacePath,
            }),
        /output conflict at `README\.md`/,
    );
});

test("accepts a stub that overwrites an existing untagged file", () => {
    const workspacePath = createTemporaryDirectory();
    writeFile(workspacePath, "BUILD", "");
    writeFile(workspacePath, "shared/BUILD", "");
    writeFile(workspacePath, "shared/value.ts", "export const value = 1;\n");
    const stubPath = writeFile(
        workspacePath,
        "shared/value.open_source.stub.ts",
        "export const value = 2;\n",
    );
    const testPath = writeFile(workspacePath, "shared/value.test.ts", "export {};\n");
    const manifest: OpenSourcePublicationManifest = {
        entries: [
            entry(stubPath, "shared/value.open_source.stub.ts", "shared/value.ts", {
                outputKind: "stub",
            }),
            entry(testPath, "shared/value.open_source.test.ts", "shared/value.test.ts", {
                isTest: true,
            }),
        ],
        importEdges: [],
    };

    assert.doesNotThrow(() =>
        validateOpenSourcePublicationManifest({
            allowedBazelPackages: new Set(["//shared"]),
            manifest,
            workspacePath,
        }),
    );
});

test("rejects a stub without an existing untagged destination", () => {
    const workspacePath = createTemporaryDirectory();
    writeFile(workspacePath, "BUILD", "");
    writeFile(workspacePath, "shared/BUILD", "");
    const stubPath = writeFile(
        workspacePath,
        "shared/value.open_source.stub.ts",
        "export const value = 2;\n",
    );
    const testPath = writeFile(workspacePath, "shared/value.test.ts", "export {};\n");
    const manifest: OpenSourcePublicationManifest = {
        entries: [
            entry(stubPath, "shared/value.open_source.stub.ts", "shared/value.ts", {
                outputKind: "stub",
            }),
            entry(testPath, "shared/value.open_source.test.ts", "shared/value.test.ts", {
                isTest: true,
            }),
        ],
        importEdges: [],
    };

    assert.throws(
        () =>
            validateOpenSourcePublicationManifest({
                allowedBazelPackages: new Set(["//shared"]),
                manifest,
                workspacePath,
            }),
        /must overwrite an existing non-open-source file at shared\/value\.ts/,
    );
});

function entry(
    inputPath: string,
    sourceRelativePath: string,
    outputPath: string,
    {
        isTest = false,
        outputKind = "source",
    }: {isTest?: boolean; outputKind?: OpenSourceOutputKind} = {},
): OpenSourcePublicationManifestEntry {
    return {
        inputPath: path.resolve(inputPath),
        isTest,
        outputKind,
        outputPath,
        selectionReasons: ["test fixture"],
        sourceRelativePath,
    };
}
