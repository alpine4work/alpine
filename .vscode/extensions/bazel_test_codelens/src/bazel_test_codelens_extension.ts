import {ExtensionContext, Terminal, Uri, commands, env, languages, window} from "vscode";
import {BazelTestCodeLensProvider} from "~/.vscode/extensions/bazel_test_codelens/src/bazel_test_codelens_provider.js";
import {findBazelTestTargetForVscode} from "~/.vscode/extensions/bazel_test_codelens/src/find_bazel_test_target_for_vscode.js";

export function activate(context: ExtensionContext) {
    const provider = new BazelTestCodeLensProvider();
    context.subscriptions.push(
        languages.registerCodeLensProvider(
            [
                {language: "typescript", pattern: "**/*.test.ts"},
                {language: "javascript", pattern: "**/*.test.js"},
                {language: "typescriptreact", pattern: "**/*.test.tsx"},
                {language: "javascriptreact", pattern: "**/*.test.jsx"},
            ],
            provider,
        ),
    );

    // Register commands
    context.subscriptions.push(
        commands.registerCommand(
            "bazelTestCodeLens.runTest",
            async (uri: Uri, testName: string) => {
                await runTest(uri, testName);
            },
        ),
    );

    context.subscriptions.push(
        commands.registerCommand(
            "bazelTestCodeLens.runTestSuite",
            async (uri: Uri, suiteName: string) => {
                await runTestSuite(uri, suiteName);
            },
        ),
    );

    context.subscriptions.push(
        commands.registerCommand(
            "bazelTestCodeLens.copyTestCommand",
            async (uri: Uri, testName: string) => {
                await copyTestCommand(uri, testName);
            },
        ),
    );
}

async function runTest(uri: Uri, testName: string) {
    const terminal = getOrCreateTerminal();
    const bazelTarget = await findBazelTestTargetForVscode(uri);

    if (!bazelTarget) {
        await window.showErrorMessage("Could not determine Bazel target for this file");
        return;
    }

    const command = getTestCommandWithFilterIfPossible(bazelTarget, testName);
    terminal.sendText(command);
    terminal.show();
}

async function runTestSuite(uri: Uri, suiteName: string) {
    const terminal = getOrCreateTerminal();
    const bazelTarget = await findBazelTestTargetForVscode(uri);

    if (!bazelTarget) {
        await window.showErrorMessage("Could not determine Bazel target for this file");
        return;
    }

    const command = getTestCommandWithFilterIfPossible(bazelTarget, suiteName);
    terminal.sendText(command);
    terminal.show();
}

async function copyTestCommand(uri: Uri, testName: string) {
    const bazelTarget = await findBazelTestTargetForVscode(uri);

    if (!bazelTarget) {
        await window.showErrorMessage("Could not determine Bazel target for this file");
        return;
    }
    const command = getTestCommandWithFilterIfPossible(bazelTarget, testName);

    await env.clipboard.writeText(command);
    await window.showInformationMessage(`Copied test command to clipboard: ${command}`);
}

function getOrCreateTerminal(): Terminal {
    const existingTerminal = window.terminals.find(t => t.name === "Bazel Test Runner");
    if (existingTerminal) {
        return existingTerminal;
    }
    return window.createTerminal("Bazel Test Runner");
}

function getTestCommandWithFilterIfPossible(bazelTarget: string, testName: string): string {
    if (testName === "") {
        return `bazel run ${bazelTarget}`;
    }

    const escapedTestName = escapeForDoubleQuotedBashString(escapeNonAsciiCharacters(testName));

    // eslint-disable-next-line cyberworlds/string-quotes
    return `bazel run ${bazelTarget} -- -t="${escapedTestName}"`; // these quotes are important for the shell
}

function escapeForDoubleQuotedBashString(value: string): string {
    return value
        .replace(/\\/g, "\\\\")
        .replace(/"/g, "\\\u201D")
        .replace(/\$/g, "\\$")
        .replace(/`/g, "\\`");
}

function escapeNonAsciiCharacters(value: string): string {
    let escapedValue = "";

    for (const character of value) {
        const characterCodePoint = character.codePointAt(0);
        if (characterCodePoint === undefined) {
            continue;
        }

        if (characterCodePoint <= 0x7f) {
            escapedValue += character;
            continue;
        }

        if (characterCodePoint <= 0xffff) {
            escapedValue += `\\u${characterCodePoint.toString(16).padStart(4, "0")}`;
            continue;
        }

        const codePointWithoutBase = characterCodePoint - 0x10000;
        const highSurrogate = 0xd800 + (codePointWithoutBase >> 10);
        const lowSurrogate = 0xdc00 + (codePointWithoutBase & 0x3ff);
        escapedValue += `\\u${highSurrogate.toString(16).padStart(4, "0")}`;
        escapedValue += `\\u${lowSurrogate.toString(16).padStart(4, "0")}`;
    }

    return escapedValue;
}

export function deactivate() {}
