// @ts-expect-error -- ESLint's runtime package does not publish declarations.
import {Linter} from "eslint";
// @ts-expect-error -- The local ESLint plugin package has no declaration file.
import eslintPluginCyberworlds from "eslint-plugin-cyberworlds";

/* eslint-disable cyberworlds/string-quotes -- Fixtures contain JavaScript source text. */

import fs from "fs";
import os from "os";
import path from "path";

const noPrivateImportsInOpenSource =
    eslintPluginCyberworlds.rules["no-private-imports-in-open-source"];

function lintOpenSourceCode(code: string, filename = "fixture.open_source.ts") {
    const linter = new Linter();
    linter.defineRule(
        "cyberworlds/no-private-imports-in-open-source",
        noPrivateImportsInOpenSource,
    );

    return linter.verify(
        code,
        {
            parserOptions: {ecmaVersion: "latest", sourceType: "module"},
            rules: {"cyberworlds/no-private-imports-in-open-source": "error"},
        },
        {filename},
    );
}

function fixOpenSourceCode(code: string) {
    const linter = new Linter();
    linter.defineRule(
        "cyberworlds/no-private-imports-in-open-source",
        noPrivateImportsInOpenSource,
    );

    return linter.verifyAndFix(
        code,
        {
            parserOptions: {ecmaVersion: "latest", sourceType: "module"},
            rules: {"cyberworlds/no-private-imports-in-open-source": "error"},
        },
        {filename: "fixture.open_source.ts"},
    );
}

test("rejects private workspace imports from open-source files", () => {
    const messages = lintOpenSourceCode('import {privateValue} from "~/private/value.js";');

    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain("may only import other `.open_source` files");
});

test("allows tagged workspace imports from open-source files", () => {
    const messages = lintOpenSourceCode(
        'import {publicValue} from "./public_value.open_source.js";',
    );

    expect(messages).toEqual([]);
});

test("allows a canonical import with a checked-in stub counterpart", () => {
    const messages = lintOpenSourceCode(
        'import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";',
    );

    expect(messages).toEqual([]);
});

test("allows any canonical import with an open-source stub counterpart", () => {
    const fixtureDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "open-source-stub-"));
    const fixtureFilename = path.join(fixtureDirectory, "fixture.open_source.ts");
    fs.writeFileSync(path.join(fixtureDirectory, "private_value.open_source.stub.ts"), "");

    try {
        const messages = lintOpenSourceCode(
            'import {privateValue} from "./private_value.js";',
            fixtureFilename,
        );

        expect(messages).toEqual([]);
    } finally {
        fs.rmSync(fixtureDirectory, {force: true, recursive: true});
    }
});

test("rejects variable dynamic imports from open-source files", () => {
    const messages = lintOpenSourceCode("import(privateModule);");

    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain("non-literal module specifiers");
});

test("rejects template dynamic imports from open-source files", () => {
    // This fixture deliberately contains JavaScript template interpolation syntax.
    // eslint-disable-next-line no-template-curly-in-string
    const messages = lintOpenSourceCode("import(`~/private/${moduleName}.js`);");

    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain("non-literal module specifiers");
});

test("rejects variable require imports from open-source files", () => {
    const messages = lintOpenSourceCode("require(privateModule);");

    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain("non-literal module specifiers");
});

test("rejects imports of publication-only stub files", () => {
    const messages = lintOpenSourceCode(
        'import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.open_source.stub.js";',
    );

    expect(messages).toHaveLength(1);
    expect(messages[0].message).toContain("cannot import `.open_source.stub` files");
});

test("fixes imports of publication-only stub files to their canonical path", () => {
    const result = fixOpenSourceCode(
        'import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.open_source.stub.js";',
    );

    expect(result.fixed).toBe(true);
    expect(result.output).toBe(
        'import {TracerEventData} from "~/shared/tracer/types/tracer_event_data.js";',
    );
    expect(result.messages).toEqual([]);
});
