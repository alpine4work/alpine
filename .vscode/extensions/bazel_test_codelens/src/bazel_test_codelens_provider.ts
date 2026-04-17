import {CodeLens, CodeLensProvider, Position, Range, TextDocument} from "vscode";

function isDynamicName(name: string): boolean {
    return (
        name.includes("${") ||
        name.includes("`") ||
        !!name.match(/\$\{[^}]+\}/) ||
        !name.match(/^['"`].*['"`]$/)
    ); // Not quoted = variable
}

function stripQuotes(str: string): string {
    return str.replace(/^['"]|['"]$/g, "");
}

function buildPathWithSubstitutions(suites: Array<{name: string; isDynamic: boolean}>): string {
    const substitutedNames = suites.map(suite => {
        if (suite.isDynamic) {
            return ".*";
        }
        return stripQuotes(suite.name);
    });

    // Filter out empty strings and join with spaces
    const nonEmptyNames = substitutedNames.filter(name => name.length > 0);

    if (nonEmptyNames.length === 0) {
        return "";
    }

    // Join with spaces, then clean up consecutive ".\*" patterns
    let result = nonEmptyNames.join(" ");

    // Replace consecutive ".\*"'s with just ".\*"
    result = result.replace(/\.\*(\s*\.\*)+/g, ".*");

    // Remove leading/trailing spaces around ".\*"
    result = result.replace(/\s+\.\*/g, ".*");
    result = result.replace(/\.\*\s+/g, ".*");

    return result;
}

export class BazelTestCodeLensProvider implements CodeLensProvider {
    provideCodeLenses(document: TextDocument): Array<CodeLens> {
        const codeLenses: Array<CodeLens> = [];
        const text = document.getText();
        const lines = text.split("\n");
        // Just find any describe/test calls and capture the first argument
        const describeRegex = /^\s*describe(?:\.only)?\s*\(\s*([^,)]+)/;
        const testRegex = /^\s*(?:it|test)(?:\.only)?\s*\(\s*([^,)]+)/;

        // Parse the file to find describe blocks and their nesting
        const suiteStack: Array<{name: string; level: number; isDynamic: boolean}> = [];

        for (let i = 0; i < lines.length; i++) {
            const line = lines[i]!;
            const indentLevel = line.length - line.trimStart().length;

            // Check for describe blocks - handle both static and dynamic
            const describeMatch = line.match(describeRegex);
            if (describeMatch) {
                const suiteName = describeMatch[1]!.trim();
                const isDynamic = isDynamicName(suiteName);

                // Remove suites that are at the same or higher level
                while (
                    suiteStack.length > 0 &&
                    suiteStack[suiteStack.length - 1]!.level >= indentLevel
                ) {
                    suiteStack.pop();
                }

                // Add current suite to stack
                suiteStack.push({name: suiteName, level: indentLevel, isDynamic: isDynamic});

                // For suite commands, substitute dynamic names with ".\*"
                const suitePath = buildPathWithSubstitutions(suiteStack);

                const position = new Position(i, 0);
                const range = new Range(position, position);

                const runSuiteCommand = {
                    title: "▶ Run Suite",
                    command: "bazelTestCodeLens.runTestSuite",
                    arguments: [document.uri, suitePath],
                };

                const copySuiteCommand = {
                    title: "Copy Test Command",
                    command: "bazelTestCodeLens.copyTestCommand",
                    arguments: [document.uri, suitePath],
                };

                codeLenses.push(new CodeLens(range, runSuiteCommand));
                codeLenses.push(new CodeLens(range, copySuiteCommand));
            }

            // Check for individual tests
            const testMatch = line.match(testRegex);
            if (testMatch) {
                const testName = testMatch[1]!;

                // Remove suites that are at the same or higher level
                while (
                    suiteStack.length > 0 &&
                    suiteStack[suiteStack.length - 1]!.level >= indentLevel
                ) {
                    suiteStack.pop();
                }

                // Check if this is a dynamic test name (contains template literals, variables,
                // etc.)
                const isDynamicTest = isDynamicName(testName);

                // Build the test path, substituting dynamic names with ".\*"
                const fullTestPath = buildPathWithSubstitutions([
                    ...suiteStack,
                    {name: testName, isDynamic: isDynamicTest},
                ]);

                const position = new Position(i, 0);
                const range = new Range(position, position);

                const runTestCommand = {
                    title: "▶ Run Test",
                    command: "bazelTestCodeLens.runTest",
                    arguments: [document.uri, fullTestPath],
                };

                const copyTestCommand = {
                    title: "Copy Test Command",
                    command: "bazelTestCodeLens.copyTestCommand",
                    arguments: [document.uri, fullTestPath],
                };

                codeLenses.push(new CodeLens(range, runTestCommand));
                codeLenses.push(new CodeLens(range, copyTestCommand));
            }
        }

        return codeLenses;
    }
}
