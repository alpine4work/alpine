/* eslint-disable no-console */
"use strict";

const path = require("path");
const {ESLint} = require("eslint");
const typescriptEslint = require("@typescript-eslint/eslint-plugin");

const workspacePath = process.env.BUILD_WORKING_DIRECTORY ?? process.cwd();

const runfilesPath = process.env.RUNFILES || workspacePath;

const eslintTypeCheckingRuleIds = new Set(
    Object.keys(typescriptEslint.configs["disable-type-checked"].rules),
);

// This is a list of rules we want to run in --fix mode (opt-in). These are
// considered safe. All other rules will be disabled in --fix mode. If you want to
// run ALL auto-fixable rules, use --fix-all mode.
const allowedFixRules = [
    "cyberworlds/sort-imports-by-source",
    "sort-imports",
    "prefer-const",
    "wrap-iife",
];

async function main() {
    const args = process.argv.slice(2);
    const fixMode = args.includes("--fix");
    const fixAllMode = args.includes("--fix-all");
    const inputPaths = args.filter(arg => arg !== "--fix" && arg !== "--fix-all");

    // `.eslintrc.cjs` looks for this global and uses it to remove lint rules that
    // require type checking.
    globalThis.__eslintDisableTypeChecking = true;

    // Since we run ESLint twice with different configurations, there are some missing
    // rules in this configuration. We don't want to report unused directive errors
    // unless they're related to the rules we're running in this configuration (all
    // rules except `@typescript-eslint/eslint-plugin`'s rules that require type
    // checking).
    //
    // These globals are added by a patch. There isn't an official ESLint feature to
    // get this behavior.
    globalThis.__eslintIgnoreUnusedDirective = ruleId => {
        return eslintTypeCheckingRuleIds.has(ruleId);
    };

    if ((fixMode || fixAllMode) && inputPaths.length === 0) {
        console.error("Usage: node eslint_test.cjs [--fix|--fix-all] <file1> [file2] ...");
        process.exit(1);
    }

    if (fixMode && fixAllMode) {
        console.error("Cannot use both --fix and --fix-all options");
        process.exit(1);
    }

    // Create initial ESLint instance to get available rules
    const eslintForRules = new ESLint({
        cwd: workspacePath,
        globInputPaths: false,
        fix: false,
        useEslintrc: false,
        overrideConfigFile: path.join(workspacePath, ".eslintrc.cjs"),
    });

    // Configure rules to run based on fix mode
    const ruleOverrides = {};

    if (fixMode) {
        // --fix mode: opt-in only specific rules, disable all others Get the configuration
        // to see what rules are currently enabled
        const config = await eslintForRules.calculateConfigForFile(inputPaths[0] || "dummy.ts");

        // Disable all rules except the allowed ones
        for (const ruleName of Object.keys(config.rules || {})) {
            if (!allowedFixRules.includes(ruleName)) {
                ruleOverrides[ruleName] = "off";
            }
        }
    }

    const eslint = new ESLint({
        cwd: workspacePath,
        globInputPaths: false,
        fix: fixMode || fixAllMode,
        useEslintrc: false,
        overrideConfigFile: path.join(workspacePath, ".eslintrc.cjs"),
        overrideConfig: Object.keys(ruleOverrides).length > 0 ? {rules: ruleOverrides} : {},
        // In fix mode, disable the removal of eslint-disable directives to prevent
        // accidental removal of intentional disable comments
        reportUnusedDisableDirectives: fixMode || fixAllMode ? "off" : undefined,
    });

    const results = await eslint.lintFiles(inputPaths);

    // Apply fixes if in fix mode
    if (fixMode || fixAllMode) {
        await ESLint.outputFixes(results);
    }

    const newResults = [];

    for (const result of results) {
        if (result.messages.length === 0) continue;

        newResults.push({
            ...result,
            messages: result.messages,
            // Use a nice, short, relative path instead of a long, obscure, path into a Bazel
            // test sandbox.
            filePath: process.env.RUNFILES
                ? path.relative(path.join(runfilesPath, "cyberworlds"), result.filePath)
                : path.relative(workspacePath, result.filePath),
        });
    }

    if (newResults.length > 0) {
        const formatter = await eslint.loadFormatter("stylish");
        process.stdout.write(await formatter.format(newResults));
        if (fixMode || fixAllMode) {
            console.log(
                "\nFixed auto-fixable issues. Remaining issues above need manual attention.",
            );
        }
        return 1;
    } else if (fixMode || fixAllMode) {
        console.log("All issues fixed successfully!");
        return 0;
    }
}

main().then(
    exitCode => {
        process.exitCode = exitCode ?? 0;
    },
    error => {
        console.error(error);
        process.exitCode = 1;
    },
);
