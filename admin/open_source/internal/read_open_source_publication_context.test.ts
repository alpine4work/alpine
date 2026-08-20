import * as assert from "node:assert/strict";

import {
    parseOpenSourceArchiveInputManifest,
    parseOpenSourceConfiguration,
} from "~/admin/open_source/internal/read_open_source_publication_context.js";

test("parses the Bazel-declared archive input manifest", () => {
    assert.deepEqual(
        parseOpenSourceArchiveInputManifest(
            JSON.stringify({
                stubDestinations: ["shared/tracer/types/tracer_event_data.ts"],
                sources: [
                    {
                        inputPath: "bazel-out/bin/shared/value.open_source.ts",
                        sourceRelativePath: "shared/value.open_source.ts",
                    },
                ],
            }),
        ),
        {
            inputSources: [
                {
                    inputPath: "bazel-out/bin/shared/value.open_source.ts",
                    sourceRelativePath: "shared/value.open_source.ts",
                },
            ],
            stubDestinations: new Set(["shared/tracer/types/tracer_event_data.ts"]),
        },
    );
});

test("parses the central package allowlist", () => {
    assert.deepEqual(
        parseOpenSourceConfiguration(
            JSON.stringify({allowedBazelPackages: ["//server/agents/cli", "//shared/helpers"]}),
        ),
        {allowedBazelPackages: new Set(["//server/agents/cli", "//shared/helpers"])},
    );
    assert.throws(
        () => parseOpenSourceConfiguration(JSON.stringify({allowedBazelPackages: ["invalid"]})),
        /unique Bazel package labels/,
    );
});
