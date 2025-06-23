"use strict";

const path = require("path");
const {ESLint} = require("eslint");
const typescriptEslint = require("@typescript-eslint/eslint-plugin");

const workspacePath = process.cwd();

const runfilesPath = process.env.RUNFILES;
if (!process.env.RUNFILES) throw new Error("Expected `RUNFILES` environment variable");

const eslintTypeCheckingRuleIds = new Set(
    Object.keys(typescriptEslint.configs["disable-type-checked"].rules),
);

async function main() {
    const inputPaths = process.argv.slice(2);

    // `.eslintrc.cjs` looks for this global and uses it to remove lint rules that
    // require type checking.
    globalThis.__eslintDisableTypeChecking = true;

    // Since we run ESLint twice with different configurations, there are some
    // missing rules in this configuration. We don't want to report unused
    // directive errors unless they're related to the rules we're running in
    // this configuration (all rules except `@typescript-eslint/eslint-plugin`'s
    // rules that require type checking).
    //
    // These globals are added by a patch. There isn't an official ESLint feature
    // to get this behavior.
    globalThis.__eslintIgnoreUnusedDirective = ruleId => {
        return eslintTypeCheckingRuleIds.has(ruleId);
    };

    const eslint = new ESLint({
        cwd: workspacePath,
        globInputPaths: false,
        fix: false,
        useEslintrc: false,
        rulePaths: [path.join(workspacePath, "admin/eslint/rules")],
        overrideConfigFile: path.join(workspacePath, ".eslintrc.cjs"),
    });

    const results = await eslint.lintFiles(inputPaths);

    const newResults = [];

    for (const result of results) {
        if (result.messages.length === 0) continue;

        newResults.push({
            ...result,
            messages: result.messages,
            // Use a nice, short, relative path instead of a long, obscure, path into a
            // Bazel test sandbox.
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
