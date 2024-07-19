"use strict";

const path = require("path");
const ts = require("typescript");
const {ESLint} = require("eslint");
const eslintConfig = require("../../../.eslintrc.cjs");

const workspacePath = process.cwd();

const runfilesPath = process.env.RUNFILES;
if (!process.env.RUNFILES) {
    throw new Error('Expected "RUNFILES" environment variable');
}

const execrootPath = process.env.JS_BINARY__EXECROOT;
if (!process.env.JS_BINARY__EXECROOT) {
    throw new Error('Expected "JS_BINARY__EXECROOT" environment variable');
}

async function main() {
    const configPath = ts.findConfigFile(workspacePath, ts.sys.fileExists, "tsconfig.json");
    if (!configPath) throw new Error('Couldn\'t find "tsconfig.json" file');
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

    const eslintTypeCheckingConfigOverride =
        eslintConfig[Symbol.for("cyberworlds.typeCheckingOverride")];
    if (
        !eslintTypeCheckingConfigOverride.parserOptions ||
        !eslintTypeCheckingConfigOverride.parserOptions.project
    ) {
        throw new Error("Expected ESLint type checking configuration to be properly setup");
    }

    // Create a `parserOptions` object which has removed our existing TypeScript
    // configuration and add `program`. So we can reuse the type checking work
    // we've already done.
    const {tsconfigRootDir, project, ...eslintTypeCheckingConfigOverrideParserOptions} =
        eslintTypeCheckingConfigOverride.parserOptions;

    eslintTypeCheckingConfigOverrideParserOptions.programs = [program];

    const eslint = new ESLint({
        cwd: workspacePath,
        fix: false,
        useEslintrc: false,
        overrideConfig: {
            // We can't enable this, unfortunately, since it will report unused disable
            // directives for rules we're not running in this ESLint pass.
            reportUnusedDisableDirectives: false,

            overrides: [
                {
                    ...eslintTypeCheckingConfigOverride,
                    parserOptions: eslintTypeCheckingConfigOverrideParserOptions,
                },
            ],
        },
    });

    // Keep track of all ESLint rules known to our full `eslintConfig`. Since we're
    // only using a subset of rules this linter run ESLint will report "rule not
    // found" errors for rules we do actually know about.
    const knownEslintRuleIds = new Set();

    if (eslintConfig.rules) {
        for (const eslintRuleId of Object.keys(eslintConfig.rules)) {
            knownEslintRuleIds.add(eslintRuleId);
        }
    }

    if (eslintConfig.overrides) {
        for (const eslintConfigOverride of eslintConfig.overrides) {
            if (eslintConfigOverride.rules) {
                for (const eslintRuleId of Object.keys(eslintConfigOverride.rules)) {
                    knownEslintRuleIds.add(eslintRuleId);
                }
            }
        }
    }

    const results = await eslint.lintFiles(rootNames);

    const newResults = [];

    for (const result of results) {
        if (result.messages.length === 0) continue;

        const newMessages = [];

        for (const message of result.messages) {
            // We do actually know about this rule it just wasn't in this linter run.
            if (
                /^Definition for rule '[a-zA-Z0-9\-/_@]+' was not found\.?$/.test(
                    message.message,
                ) &&
                knownEslintRuleIds.has(message.ruleId)
            ) {
                continue;
            }

            newMessages.push(message);
        }

        if (newMessages.length === 0) continue;

        newResults.push({
            ...result,
            messages: newMessages,
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
