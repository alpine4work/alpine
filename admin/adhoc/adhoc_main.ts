/// <reference types="@types/node" />

import "~/server/helpers/node/register_noop_react_refresh.js";

import fs from "fs-extra";
import {join as joinPath} from "path";
import {getWorkspacePath} from "~/server/helpers/node/workspace_path.js";
import {InternalError} from "~/shared/error/error.js";
import {quote} from "~/shared/helpers/string/quote.js";

// Make our adhoc process easy to find in process managers so we can hunt down
// runaway scripts. We include "cyberworlds" and "node" so you can grep by those
// strings.
process.title = "adhoc (cyberworlds, node)";

const scriptNamePattern = /^[a-z][a-z0-9_]*$/;

async function main() {
    const arg = process.argv[2] ?? "";

    if (arg === "new") {
        await createNewScript();
        return;
    }

    if (arg === "list") {
        await listScripts();
        return;
    }

    if (arg === "") {
        await runScript("./adhoc_local.js");
        return;
    }

    if (!scriptNamePattern.test(arg)) {
        throw new InternalError(
            quote`Invalid script name ${arg}. Script names must be lowercase` +
                ` alphanumeric with underscores (e.g. \u201Cmy_script\u201D)`,
        );
    }

    await runScript(`./adhoc_local_${arg}.js`);
}

async function runScript(modulePath: string) {
    let adhocModule: {run?: () => Promise<void>};

    try {
        adhocModule = await import(modulePath);
    } catch (error) {
        throw InternalError.from(error, `Could not import \`${modulePath}\``);
    }

    const {run} = adhocModule;

    if (typeof run !== "function")
        throw new InternalError(`Could not find \`run()\` function in \`${modulePath}\``);

    await run();
}

async function listScripts() {
    const workspacePath = getWorkspacePath();
    const adhocDir = joinPath(workspacePath, "admin/adhoc");
    const files = fs
        .readdirSync(adhocDir)
        .filter((f: string) => /^adhoc_local_[a-z][a-z0-9_]*\.ts$/.test(f))
        .sort();

    if (files.length === 0) {
        // eslint-disable-next-line no-console
        console.log("No scripts found. Create one with: `dev adhoc new <script_name>`");
        return;
    }

    const scripts: Array<{name: string; description: string}> = [];
    for (const file of files) {
        const name = file.replace(/^adhoc_local_/, "").replace(/\.ts$/, "");
        let description = "";
        try {
            const mod: {description?: string} = await import(`./${file.replace(/\.ts$/, ".js")}`);
            description = typeof mod.description === "string" ? mod.description : "";
        } catch {
            description = "(not built)";
        }
        scripts.push({name, description});
    }

    const maxNameLength = Math.max("Name".length, ...scripts.map(s => s.name.length));

    // eslint-disable-next-line no-console
    console.log(`${"Name".padEnd(maxNameLength)}  Description`);
    // eslint-disable-next-line no-console
    console.log(`${"─".repeat(maxNameLength)}  ${"─".repeat(40)}`);
    for (const {name, description} of scripts) {
        // eslint-disable-next-line no-console
        console.log(`${name.padEnd(maxNameLength)}  ${description}`);
    }
}

async function createNewScript() {
    const rawName = process.argv[3] ?? "";

    if (rawName === "") {
        throw new InternalError("Usage: `dev adhoc new <script_name>`");
    }

    assertValidScriptName(rawName);

    const relativePath = createScriptFromTemplate({
        rawName,
        templateFileName: "adhoc_local.template.ts",
    });

    // eslint-disable-next-line no-console
    console.log(`Created \`${relativePath}\``);
    // eslint-disable-next-line no-console
    console.log(`Run with: \`dev adhoc ${rawName}\``);
}

function assertValidScriptName(rawName: string) {
    if (!scriptNamePattern.test(rawName)) {
        throw new InternalError(
            quote`Invalid script name ${rawName}. Script names must be lowercase` +
                ` alphanumeric with underscores (e.g. \u201Cmy_script\u201D)`,
        );
    }
}

function createScriptFromTemplate({
    rawName,
    templateFileName,
    replacements = [],
}: {
    rawName: string;
    templateFileName: string;
    replacements?: Array<{from: string; to: string}>;
}) {
    const workspacePath = getWorkspacePath();
    const adhocDir = joinPath(workspacePath, "admin/adhoc");

    const fileName = `adhoc_local_${rawName}.ts`;
    const filePath = joinPath(adhocDir, fileName);

    if (fs.existsSync(filePath)) {
        throw new InternalError(`Script already exists at \`admin/adhoc/${fileName}\``);
    }

    const templatePath = joinPath(adhocDir, templateFileName);
    let template = fs.readFileSync(templatePath, "utf8");
    // Strip eslint-disable comments so the new script presents lint errors for unused
    // variables, prompting the developer to use or remove them.
    template = template.replace(/^\s*\/\/ eslint-disable-next-line.*\n/gm, "");

    for (const {from, to} of replacements) {
        template = template.replaceAll(from, to);
    }

    fs.writeFileSync(filePath, template);

    return `admin/adhoc/${fileName}`;
}

main().catch(error => {
    // eslint-disable-next-line no-console
    console.error(error);
    process.exitCode = 1;
});
