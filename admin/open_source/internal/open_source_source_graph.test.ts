/* eslint-disable cyberworlds/string-quotes -- Fixtures contain JavaScript source text. */

import * as assert from "node:assert/strict";

import {
    listOpenSourceModuleSpecifiers,
    resolveOpenSourceWorkspaceImport,
} from "~/admin/open_source/internal/open_source_source_graph.js";
import {
    createTemporaryDirectory,
    writeFile,
} from "~/admin/open_source/internal/open_source_test_helpers.js";

test("lists every supported JavaScript and TypeScript module reference", () => {
    const source = [
        '/// <reference path="./ambient.d.ts" />',
        'import value from "./value.js";',
        'export type {Value} from "./types.js";',
        'const lazy = import("./lazy.js");',
        'const required = require("./required.cjs");',
        'const resolved = require.resolve("./resolved.js");',
        'const worker = new URL("./worker.js", import.meta.url);',
        "export {lazy, required, resolved, value, worker};",
    ].join("\n");

    assert.deepEqual(listOpenSourceModuleSpecifiers(source, "entry.ts"), [
        "./ambient.d.ts",
        "./lazy.js",
        "./required.cjs",
        "./resolved.js",
        "./types.js",
        "./value.js",
        "./worker.js",
    ]);
});

test("resolves NodeNext JavaScript imports to declaration and module source files", () => {
    const workspacePath = createTemporaryDirectory();
    writeFile(workspacePath, "shared/declaration.d.ts", "export type Value = string;\n");
    writeFile(workspacePath, "shared/module.mts", "export const value = 1;\n");
    writeFile(workspacePath, "shared/legacy.cts", "export const legacy = 1;\n");

    assert.equal(
        resolveOpenSourceWorkspaceImport({
            moduleSpecifier: "~/shared/declaration.js",
            sourceRelativePath: "entry.ts",
            workspacePath,
        }),
        "shared/declaration.d.ts",
    );
    assert.equal(
        resolveOpenSourceWorkspaceImport({
            moduleSpecifier: "~/shared/module.mjs",
            sourceRelativePath: "entry.ts",
            workspacePath,
        }),
        "shared/module.mts",
    );
    assert.equal(
        resolveOpenSourceWorkspaceImport({
            moduleSpecifier: "~/shared/legacy.cjs",
            sourceRelativePath: "entry.ts",
            workspacePath,
        }),
        "shared/legacy.cts",
    );
});

test("rejects a non-literal dynamic import", () => {
    assert.throws(
        () => listOpenSourceModuleSpecifiers("import(modulePath);", "shared/dynamic.ts"),
        /shared\/dynamic\.ts uses a non-literal dynamic import.*statically auditable/,
    );
});

test("rejects a non-literal require call", () => {
    assert.throws(
        () => listOpenSourceModuleSpecifiers("require(modulePath);", "shared/dynamic.cjs"),
        /shared\/dynamic\.cjs uses a non-literal require call.*statically auditable/,
    );
});

test("rejects a non-literal require.resolve call", () => {
    assert.throws(
        () => listOpenSourceModuleSpecifiers("require.resolve(modulePath);", "shared/dynamic.cjs"),
        /shared\/dynamic\.cjs uses a non-literal require\.resolve call.*statically auditable/,
    );
});

test("rejects a non-literal URL module reference even with extra arguments", () => {
    assert.throws(
        () =>
            listOpenSourceModuleSpecifiers(
                "new URL(modulePath, import.meta.url, undefined);",
                "shared/dynamic.ts",
            ),
        /shared\/dynamic\.ts uses a non-literal URL module reference.*statically auditable/,
    );
});
