import * as inquirer from "@inquirer/prompts";
import fs from "fs/promises";
import {join as joinPath} from "path";
import {getWorkspacePath} from "~/server/helpers/node/workspace_path.js";
import {FailedPreconditionError, InvalidArgumentError} from "~/shared/error/error.js";
import {assert} from "~/shared/helpers/control/assert.js";

const demoNameRegExp = /^[a-z][a-z0-9_]*$/;

main()
    .then(() => {
        process.exit(0);
    })
    .catch((error: Error) => {
        // eslint-disable-next-line no-console
        console.error(`${error.name}: ${error.message}`);
        process.exitCode = 1;
    });

async function main() {
    const demoName = await getDemoName();

    const workspacePath = getWorkspacePath();
    const rootDirectory = joinPath(workspacePath, "admin/marketing/2026_04_scalable_demos");
    const demosDirectory = joinPath(rootDirectory, "demos");

    const existingFiles = await fs.readdir(demosDirectory);

    const collisionRegExp = new RegExp(`^\\d{3}_${demoName}_demo_`);
    const collision = existingFiles.find(f => collisionRegExp.test(f));
    if (collision) {
        throw new FailedPreconditionError(
            `Demo name \u201C${demoName}\u201D is already used by ${collision}`,
        );
    }

    const demoNumber = nextDemoNumber(existingFiles);
    const demoNamePascal = snakeToPascalCase(demoName);
    const demoNameCamel = pascalToCamelCase(demoNamePascal);

    const templates = [
        {
            source: "000_demo_composition.template.tsx",
            target: `${demoNumber}_${demoName}_demo_composition.tsx`,
        },
        {
            source: "000_demo_recorder.template.ts",
            target: `${demoNumber}_${demoName}_demo_recorder.ts`,
        },
        {
            source: "000_demo_shared.template.ts",
            target: `${demoNumber}_${demoName}_demo_shared.ts`,
        },
    ];

    for (const {source, target} of templates) {
        const content = await fs.readFile(joinPath(demosDirectory, source), "utf8");
        const substituted = content
            // Strip template-only suppression comments (eslint-disable and @ts-expect-error)
            // so generated files are checked normally.
            .split("\n")
            .filter(line => !/@ts-expect-error/.test(line) && !/eslint-disable/.test(line))
            .join("\n")
            .replaceAll("__DEMO_NUMBER__", demoNumber)
            .replaceAll("__DEMO_NAME__", demoName)
            .replaceAll("__DemoName__", demoNamePascal)
            .replaceAll("__demoName__", demoNameCamel);
        await fs.writeFile(joinPath(demosDirectory, target), substituted);
    }

    await updateRemotionRoot(rootDirectory, {demoNumber, demoName, demoNamePascal, demoNameCamel});
    await updateRepositoriesBzl(rootDirectory, {demoNumber, demoName});

    // eslint-disable-next-line no-console
    console.log(
        [
            "",
            `Created demo ${demoNumber}_${demoName}:`,
            `  demos/${demoNumber}_${demoName}_demo_composition.tsx`,
            `  demos/${demoNumber}_${demoName}_demo_recorder.ts`,
            `  demos/${demoNumber}_${demoName}_demo_shared.ts`,
            "",
            "Updated scalable_demos_remotion_root.tsx and scalable_demo_repositories.bzl.",
            "",
            "Next steps:",
            `  1. Record a take: bazel run //admin/marketing/2026_04_scalable_demos:${demoNumber}_${demoName}_demo_recorder`,
            "  2. Upload the .mov to the `2026_04_scalable_demos` Google Drive folder.",
            "  3. Uncomment the entry in scalable_demo_repositories.bzl and fill in url + integrity.",
            `  4. Fill in frame numbers in demos/${demoNumber}_${demoName}_demo_shared.ts.`,
            "",
        ].join("\n"),
    );
}

/**
 * Parse `--name <value>` / `--name=<value>` out of `process.argv`. If not
 * provided, prompt the user interactively. Validates against `demoNameRegExp`.
 */
async function getDemoName(): Promise<string> {
    const argv = process.argv.slice(2);
    let name: string | undefined;
    for (let i = 0; i < argv.length; i++) {
        const arg = argv[i]!;
        if (arg === "--name") {
            name = argv[i + 1];
            i++;
        } else if (arg.startsWith("--name=")) {
            name = arg.slice("--name=".length);
        }
    }

    if (name === undefined) {
        return inquirer.input({
            message: "Demo name (snake_case):",
            validate: value =>
                demoNameRegExp.test(value) ||
                "Name must be snake_case (lowercase letters, digits, underscores; starts with a letter)",
        });
    }

    if (!demoNameRegExp.test(name)) {
        throw new InvalidArgumentError(
            `Invalid demo name \u201C${name}\u201D, must match ${demoNameRegExp.source}`,
        );
    }

    return name;
}

/**
 * Scan the demos directory for files matching
 * `{NNN}_{name}_demo_{composition|recorder|shared}.{ts,tsx}`, take the max `NNN`,
 * add 1, return zero-padded to 3 digits.
 */
function nextDemoNumber(existingFiles: ReadonlyArray<string>): string {
    const demoFileRegExp = /^(\d{3})_.*_demo_(composition\.tsx|recorder\.ts|shared\.ts)$/;
    let maxNumber = 0;
    for (const file of existingFiles) {
        const match = file.match(demoFileRegExp);
        if (match) {
            const n = parseInt(match[1]!, 10);
            if (n > maxNumber) maxNumber = n;
        }
    }
    return (maxNumber + 1).toString().padStart(3, "0");
}

/**
 * Convert a snake_case name (e.g. `share_switch`) to PascalCase (`ShareSwitch`).
 */
function snakeToPascalCase(snakeCase: string): string {
    return snakeCase
        .split("_")
        .map(part => part.charAt(0).toUpperCase() + part.slice(1))
        .join("");
}

/**
 * Convert a PascalCase name (e.g. `ShareSwitch`) to camelCase (`shareSwitch`).
 */
function pascalToCamelCase(pascalCase: string): string {
    return pascalCase.charAt(0).toLowerCase() + pascalCase.slice(1);
}

/**
 * Insert new imports + `<Composition>` block into
 * `scalable_demos_remotion_root.tsx`. Since new demos always have the highest
 * number, insertion is always "at the end" of the existing demo imports and
 * compositions.
 */
async function updateRemotionRoot(
    rootDirectory: string,
    {
        demoNumber,
        demoName,
        demoNamePascal,
        demoNameCamel,
    }: {
        demoNumber: string;
        demoName: string;
        demoNamePascal: string;
        demoNameCamel: string;
    },
) {
    const rootFilePath = joinPath(rootDirectory, "scalable_demos_remotion_root.tsx");
    const content = await fs.readFile(rootFilePath, "utf8");

    // Insert two new imports after the last `demos/*_demo_shared.js` import.
    const importRegExp =
        /^import \{[^}]*\} from "~\/admin\/marketing\/2026_04_scalable_demos\/demos\/\d{3}_[^"]*_demo_shared\.js";$/gm;
    let lastImportMatch: RegExpExecArray | null = null;
    for (let m = importRegExp.exec(content); m !== null; m = importRegExp.exec(content)) {
        lastImportMatch = m;
    }
    assert(lastImportMatch, "Couldn\u2019t find any demo shared imports in root file");

    const newImports =
        // The straight double quotes in the generated import specifiers are
        // TypeScript syntax, not prose — they must not be replaced with
        // typographic quotes.
        // eslint-disable-next-line cyberworlds/string-quotes
        `\nimport {${demoNamePascal}DemoComposition} from "~/admin/marketing/2026_04_scalable_demos/demos/${demoNumber}_${demoName}_demo_composition.js";` +
        // eslint-disable-next-line cyberworlds/string-quotes
        `\nimport {${demoNameCamel}DemoDurationInFrames} from "~/admin/marketing/2026_04_scalable_demos/demos/${demoNumber}_${demoName}_demo_shared.js";`;

    const insertAfterImport = lastImportMatch.index + lastImportMatch[0].length;
    const withImports =
        content.slice(0, insertAfterImport) + newImports + content.slice(insertAfterImport);

    // Insert a new <Composition> block before the closing `</>` of the root fragment.
    const demoIdName = demoName.replaceAll("_", "-");
    const newComposition =
        `            <Composition\n` +
        // The straight double quotes in the generated JSX attribute are TypeScript syntax,
        // not prose — they must not be replaced with typographic quotes.
        `                id="${demoNumber}-${demoIdName}-demo"\n` +
        `                component={${demoNamePascal}DemoComposition}\n` +
        `                durationInFrames={${demoNameCamel}DemoDurationInFrames}\n` +
        `            />\n`;

    const closingFragment = "        </>";
    const closingIndex = withImports.indexOf(closingFragment);
    assert(closingIndex >= 0, "Couldn\u2019t find closing </> in root file");

    const final =
        withImports.slice(0, closingIndex) + newComposition + withImports.slice(closingIndex);

    await fs.writeFile(rootFilePath, final);
}

/**
 * Insert a placeholder entry into `SCALABLE_DEMOS_REPOSITORIES`. Placeholder has
 * empty `url` and `integrity` that the developer fills in after uploading the
 * recording to Google Drive.
 */
async function updateRepositoriesBzl(
    rootDirectory: string,
    {demoNumber, demoName}: {demoNumber: string; demoName: string},
) {
    const bzlFilePath = joinPath(rootDirectory, "scalable_demo_repositories.bzl");
    const content = await fs.readFile(bzlFilePath, "utf8");

    // Find the closing `    },` of the last `*_demo_recording_*.mov` entry. New demo
    // entries always go after existing ones and before the static
    // (`rachel_date_background_*.jpeg`) entries.
    const entryStartRegExp = /^    "\d{3}_.*_demo_recording_\d{2}\.mov": \{$/gm;
    let lastEntryStart: RegExpExecArray | null = null;
    for (let m = entryStartRegExp.exec(content); m !== null; m = entryStartRegExp.exec(content)) {
        lastEntryStart = m;
    }
    assert(lastEntryStart, "Couldn\u2019t find any demo recording entries in repositories bzl");

    const closingMarker = "    },\n";
    const closingIndex = content.indexOf(
        closingMarker,
        lastEntryStart.index + lastEntryStart[0].length,
    );
    assert(closingIndex >= 0, "Couldn\u2019t find closing `},` for last demo recording entry");

    const insertAt = closingIndex + closingMarker.length;

    // The straight double quotes in the generated Starlark dict entries are Starlark
    // syntax, not prose — they must not be replaced with typographic quotes.
    //
    // The entry is inserted _commented out_ so the Bazel workspace keeps loading
    // before the recording is uploaded (empty `url` would fail the Google Drive URL
    // check in `scalable_demo_repositories()`). The commit-blocker marker in the
    // leading comment intentionally blocks the branch from merging until the developer
    // uploads the `.mov`, uncomments the entry, and fills in `url` + `integrity`.
    // eslint-disable-next-line no-useless-concat -- intentionally split to avoid triggering the commit blocker check on this file
    const commitBlocker = "NO" + "COMMIT";
    /* eslint-disable cyberworlds/string-quotes */
    const newEntry =
        `    # ${commitBlocker}: Add the video asset here.\n` +
        `    # "${demoNumber}_${demoName}_demo_recording_01.mov": {\n` +
        `    #     "url": "",\n` +
        `    #     "integrity": "",\n` +
        `    # },\n`;
    /* eslint-enable cyberworlds/string-quotes */

    const final = content.slice(0, insertAt) + newEntry + content.slice(insertAt);

    await fs.writeFile(bzlFilePath, final);
}
