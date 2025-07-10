import * as vscode from "vscode";
import {BazelTestCodeLensProvider} from "~/.vscode/extensions/bazel_test_codelens/src/bazel_test_codelens_provider.js";
import {findBazelTestTargetForVscode} from "~/.vscode/extensions/bazel_test_codelens/src/find_bazel_test_target_for_vscode.js";

export function activate(context: vscode.ExtensionContext) {
    const provider = new BazelTestCodeLensProvider();
    context.subscriptions.push(
        vscode.languages.registerCodeLensProvider(
            [
                {language: "typescript", pattern: "**/*.test.{ts,js,jsx,tsx}"},
                {language: "javascript", pattern: "**/*.test.{ts,js,jsx,tsx}"},
            ],
            provider,
        ),
    );

    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand(
            "bazelTestCodeLens.runTest",
            async (uri: vscode.Uri, testName: string) => {
                await runTest(uri, testName);
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "bazelTestCodeLens.runTestSuite",
            async (uri: vscode.Uri, suiteName: string) => {
                await runTestSuite(uri, suiteName);
            },
        ),
    );

    context.subscriptions.push(
        vscode.commands.registerCommand(
            "bazelTestCodeLens.copyTestCommand",
            async (uri: vscode.Uri, testName: string) => {
                await copyTestCommand(uri, testName);
            },
        ),
    );
}

async function runTest(uri: vscode.Uri, testName: string) {
    const terminal = getOrCreateTerminal();
    const bazelTarget = await findBazelTestTargetForVscode(uri);

    if (!bazelTarget) {
        await vscode.window.showErrorMessage("Could not determine Bazel target for this file");
        return;
    }

    const command = getTestCommandWithFilterIfPossible(bazelTarget, testName);
    terminal.sendText(command);
    terminal.show();
}

async function runTestSuite(uri: vscode.Uri, suiteName: string) {
    const terminal = getOrCreateTerminal();
    const bazelTarget = await findBazelTestTargetForVscode(uri);

    if (!bazelTarget) {
        await vscode.window.showErrorMessage("Could not determine Bazel target for this file");
        return;
    }

    const command = getTestCommandWithFilterIfPossible(bazelTarget, suiteName);
    terminal.sendText(command);
    terminal.show();
}

async function copyTestCommand(uri: vscode.Uri, testName: string) {
    const bazelTarget = await findBazelTestTargetForVscode(uri);

    if (!bazelTarget) {
        await vscode.window.showErrorMessage("Could not determine Bazel target for this file");
        return;
    }
    const command = getTestCommandWithFilterIfPossible(bazelTarget, testName);

    await vscode.env.clipboard.writeText(command);
    await vscode.window.showInformationMessage(`Copied test command to clipboard: ${command}`);
}

function getOrCreateTerminal(): vscode.Terminal {
    const existingTerminal = vscode.window.terminals.find(t => t.name === "Bazel Test Runner");
    if (existingTerminal) {
        return existingTerminal;
    }
    return vscode.window.createTerminal("Bazel Test Runner");
}

const getTestCommandWithFilterIfPossible = (bazelTarget: string, testName: string) => {
    if (testName === "") {
        return `bazel run ${bazelTarget}`;
    }

    // eslint-disable-next-line string-quotes
    return `bazel run ${bazelTarget} -- -t="${testName}"`; // these quotes are important for the shell
};

export function deactivate() {}
