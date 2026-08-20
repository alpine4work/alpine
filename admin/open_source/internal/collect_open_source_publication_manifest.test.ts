/* eslint-disable cyberworlds/string-quotes -- Fixtures contain JavaScript source text. */

import * as assert from "node:assert/strict";
import * as fs from "node:fs";
import * as path from "node:path";
import {
    type OpenSourceDeclaredSource,
    collectOpenSourcePublicationManifestFromDeclaredSources,
    stripOpenSourceTagsFromPath,
} from "~/admin/open_source/internal/collect_open_source_publication_manifest.js";

import {
    createWorkspaceFixture,
    writeFile,
} from "~/admin/open_source/internal/open_source_test_helpers.js";

/**
 * Creates an input record in the exact shape passed from the Bazel archive rule.
 */
function declaredSource(
    workspacePath: string,
    sourceRelativePath: string,
): OpenSourceDeclaredSource {
    return {
        inputPath: path.join(workspacePath, ...sourceRelativePath.split("/")),
        sourceRelativePath,
    };
}

test("collects only Bazel-declared tagged inputs and records their public import edges", () => {
    const {workspacePath} = createWorkspaceFixture();
    writeFile(workspacePath, "shared/value.open_source.ts", "export const value = 1;\n");
    writeFile(
        workspacePath,
        "shared/value.open_source.test.ts",
        'import {value} from "./value.open_source.js";\nexport {value};\n',
    );
    writeFile(workspacePath, "README.open_source.md", "# Community README\n");

    const manifest = collectOpenSourcePublicationManifestFromDeclaredSources({
        stubDestinations: new Set(),
        sourceInputs: [
            declaredSource(workspacePath, "README.open_source.md"),
            declaredSource(workspacePath, "shared/value.open_source.test.ts"),
            declaredSource(workspacePath, "shared/value.open_source.ts"),
        ],
    });

    assert.deepEqual(
        manifest.entries.map(entry => entry.outputPath),
        ["README.md", "shared/value.test.ts", "shared/value.ts"],
    );
    assert.deepEqual(manifest.importEdges, [
        {
            fromOutputPath: "shared/value.test.ts",
            fromSourcePath: "shared/value.open_source.test.ts",
            kind: "workspace",
            moduleSpecifier: "./value.open_source.js",
            toOutputPath: "shared/value.ts",
        },
    ]);
    assert.equal(Object.isFrozen(manifest), true);
});

test("maps a declared stub to its canonical private import path without reading that file", () => {
    const {workspacePath} = createWorkspaceFixture();
    const stubSourcePath = "shared/tracer/types/tracer_event_data.open_source.stub.ts";
    const consumerSourcePath = "shared/tracer/consumer.open_source.test.ts";
    writeFile(workspacePath, stubSourcePath, "export type TracerEventData = unknown;\n");
    writeFile(
        workspacePath,
        consumerSourcePath,
        'import type {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";\nexport type Consumer = TracerEventData;\n',
    );

    const manifest = collectOpenSourcePublicationManifestFromDeclaredSources({
        stubDestinations: new Set(["shared/tracer/types/tracer_event_data.ts"]),
        sourceInputs: [
            declaredSource(workspacePath, consumerSourcePath),
            declaredSource(workspacePath, stubSourcePath),
        ],
    });

    assert.deepEqual(manifest.importEdges, [
        {
            fromOutputPath: "shared/tracer/consumer.test.ts",
            fromSourcePath: consumerSourcePath,
            kind: "workspace",
            moduleSpecifier: "~/shared/tracer/types/tracer_event_data.js",
            toOutputPath: "shared/tracer/types/tracer_event_data.ts",
        },
    ]);
});

test("rejects an undeclared or symbolic Bazel input instead of searching for another file", () => {
    const {workspacePath} = createWorkspaceFixture();
    const sourcePath = path.join(workspacePath, "shared", "value.open_source.ts");
    fs.mkdirSync(path.dirname(sourcePath), {recursive: true});
    fs.symlinkSync(path.join(workspacePath, "outside.ts"), sourcePath);

    assert.throws(
        () =>
            collectOpenSourcePublicationManifestFromDeclaredSources({
                stubDestinations: new Set(),
                sourceInputs: [declaredSource(workspacePath, "shared/value.open_source.ts")],
            }),
        /is not a regular file/,
    );
});

test("strips tags from file and directory names while preserving compound extensions", () => {
    assert.equal(stripOpenSourceTagsFromPath("types/value.open_source.d.ts"), "types/value.d.ts");
    assert.equal(stripOpenSourceTagsFromPath("types/value.open_source.stub.ts"), "types/value.ts");
    assert.equal(
        stripOpenSourceTagsFromPath("types/value.open_source.test.ts"),
        "types/value.test.ts",
    );
    assert.equal(
        stripOpenSourceTagsFromPath(".github/workflows/check.open_source.yaml"),
        ".github/workflows/check.yaml",
    );
});
