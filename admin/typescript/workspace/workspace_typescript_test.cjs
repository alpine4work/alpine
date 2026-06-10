"use strict";

const path = require("path");
const ts = require("typescript");
const {ESLint} = require("eslint");
const typescriptEslint = require("@typescript-eslint/eslint-plugin");
const eslintConfig = require("../../../.eslintrc.cjs");

const workspacePath = process.cwd();

const runfilesPath = process.env.RUNFILES;
if (!process.env.RUNFILES) throw new Error("Expected `RUNFILES` environment variable");

const execrootPath = process.env.JS_BINARY__EXECROOT;
if (!process.env.JS_BINARY__EXECROOT)
    throw new Error("Expected `JS_BINARY__EXECROOT` environment variable");

const eslintTypeCheckingRuleIds = new Set(
    Object.keys(typescriptEslint.configs["disable-type-checked"].rules),
);

const eslintTypeCheckingConfigOverride =
    eslintConfig[Symbol.for("cyberworlds.typeCheckingOverride")];

if (
    !eslintTypeCheckingConfigOverride.parserOptions ||
    !eslintTypeCheckingConfigOverride.parserOptions.project
) {
    throw new Error("Expected ESLint type checking configuration to be properly setup");
}

async function main() {
    const configPath = ts.findConfigFile(workspacePath, ts.sys.fileExists, "tsconfig.json");
    if (!configPath) throw new Error("Couldn\u2019t find `tsconfig.json` file");
    const {config} = ts.readConfigFile(configPath, ts.sys.readFile);

    const {
        options,
        fileNames: rootNames,
        errors: configFileParsingDiagnostics,
    } = ts.parseJsonConfigFileContent(config, ts.sys, workspacePath);

    const program = ts.createProgram({
        options,
        rootNames,
        configFileParsingDiagnostics,
    });

    const {diagnostics: emitDiagnostics} = program.emit();

    const diagnostics = ts
        .getPreEmitDiagnostics(program)
        .concat(emitDiagnostics, configFileParsingDiagnostics);

    if (diagnostics.length > 0) {
        process.stdout.write(
            ts.formatDiagnosticsWithColorAndContext(diagnostics, {
                getNewLine: () => ts.sys.newLine,
                getCanonicalFileName: fileName => fileName,
                getCurrentDirectory: () => execrootPath,
            }),
        );
        return 1;
    }

    // Create a `parserOptions` object which has removed our existing TypeScript
    // configuration and add `program`. So we can reuse the type checking work we've
    // already done.
    const {tsconfigRootDir, project, ...eslintTypeCheckingConfigOverrideParserOptions} =
        eslintTypeCheckingConfigOverride.parserOptions;

    eslintTypeCheckingConfigOverrideParserOptions.programs = [program];

    // Since we run ESLint twice with different configurations, there are some missing
    // rules in this configuration. We don't want to report missing rule errors or
    // unused directive errors unless they're related to the rules we're running in
    // this configuration (`@typescript-eslint/eslint-plugin`'s rules that require type
    // checking).
    //
    // These globals are added by a patch. There isn't an official ESLint feature to
    // get this behavior.
    {
        globalThis.__eslintIgnoreMissingRule = ruleId => {
            return !eslintTypeCheckingRuleIds.has(ruleId);
        };

        globalThis.__eslintIgnoreUnusedDirective = ruleId => {
            return !eslintTypeCheckingRuleIds.has(ruleId);
        };
    }

    const eslint = new ESLint({
        cwd: workspacePath,
        globInputPaths: false,
        fix: false,
        useEslintrc: false,
        overrideConfig: {
            reportUnusedDisableDirectives: true,

            overrides: [
                {
                    ...eslintTypeCheckingConfigOverride,
                    parserOptions: eslintTypeCheckingConfigOverrideParserOptions,
                },
            ],
        },
    });

    const results = await eslint.lintFiles(rootNames);

    const newResults = [];

    for (const result of results) {
        if (result.messages.length === 0) continue;

        newResults.push({
            ...result,
            // Use a nice, short, relative path instead of a long, obscure, path into a Bazel
            // test sandbox.
            filePath: path.relative(path.join(runfilesPath, "cyberworlds"), result.filePath),
        });
    }

    if (newResults.length > 0) {
        const formatter = await eslint.loadFormatter("stylish");
        process.stdout.write(await formatter.format(newResults));
        return 1;
    }
}

main().then(
    exitCode => {
        process.exitCode = exitCode ?? 0;
    },
    error => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exitCode = 1;
    },
);
