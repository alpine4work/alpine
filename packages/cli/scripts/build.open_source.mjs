import {build} from "esbuild";
import {chmod, readFile, readdir, rm} from "node:fs/promises";
import {basename, dirname, join, resolve} from "node:path";
import {fileURLToPath} from "node:url";

// Public build scripts live outside the workspace source directories, so they use an ordinary
// relative module path.
// eslint-disable-next-line cyberworlds/sort-imports-by-source
import {createEsbuildWorkspacePlugin} from "../../../scripts/esbuild_workspace_plugin.open_source.mjs";

/**
 * Bundles the published Alpine CLI entry points and their JavaScript dependencies.
 * The native LMDB package remains external because npm installs its platform
 * binary.
 */
const scriptDirectoryPath = dirname(fileURLToPath(import.meta.url));
const repositoryPath = resolve(scriptDirectoryPath, "../../..");
const outputPath = join(repositoryPath, "packages/cli/dist");
const skillDirectoryPath = join(repositoryPath, "skills/alpine");
const skillModuleImport = "~/server/agents/web/agent_web_skill_content_by_path.js";
const outputBanner = `#!/usr/bin/env node
import {createRequire as createAlpineRequire} from "node:module";
const require = createAlpineRequire(import.meta.url);`;

// A build must never leave files from an older bundle in the npm package.
await rm(outputPath, {recursive: true, force: true});

await build({
    absWorkingDir: repositoryPath,
    // The bundle is ESM, but a few bundled dependencies still load Node built-ins with CommonJS.
    // Give esbuild's generated dynamic-require helper the native resolver it needs at runtime.
    banner: {js: outputBanner},
    bundle: true,
    define: {"process.env.NODE_ENV": JSON.stringify("production")},
    entryPoints: {
        alpine: "server/agents/cli/cli_main.open_source.ts",
        cli_tracer_background_main: "server/agents/cli/cli_tracer_background_main.open_source.ts",
    },
    entryNames: "[name]",
    format: "esm",
    logLevel: "info",
    outdir: outputPath,
    external: ["lmdb"],
    platform: "node",
    plugins: [skillContentPlugin(), createEsbuildWorkspacePlugin(repositoryPath)],
    sourcemap: true,
    target: "node22",
    tsconfig: join(repositoryPath, "tsconfig.json"),
});

// npm links this file directly from the package's `bin` declaration.
await chmod(join(outputPath, "alpine.js"), 0o755);

/**
 * Creates the virtual source module backed by published skill Markdown files.
 */
function skillContentPlugin() {
    return {
        name: "alpine-skill-content",
        setup(buildContext) {
            buildContext.onResolve(
                {filter: /^~\/server\/agents\/web\/agent_web_skill_content_by_path\.js$/},
                () => ({
                    namespace: "alpine-skill-content",
                    path: skillModuleImport,
                }),
            );

            buildContext.onLoad({filter: /.*/, namespace: "alpine-skill-content"}, async () => ({
                contents: await createSkillContentModule(),
                loader: "js",
            }));
        },
    };
}

/** Serializes published skills into the map expected by the CLI runtime. */
async function createSkillContentModule() {
    const skillFileNames = (await readdir(skillDirectoryPath))
        .filter(fileName => fileName.endsWith(".md"))
        .sort();

    const entries = [];
    for (const skillFileName of skillFileNames) {
        const skillPath = join(skillDirectoryPath, skillFileName);
        const content = transformSkillContent(await readFile(skillPath, "utf8"));
        entries.push([basename(skillFileName, ".md"), content.trimEnd()]);
    }

    return `export const agentWebSkillContentByPath = new Map(${JSON.stringify(entries)});\n`;
}

/**
 * Removes monorepo-only frontmatter and rewrites local links for CLI navigation.
 */
function transformSkillContent(content) {
    return (
        content
            // Skill frontmatter configures the monorepo loader and is not public CLI content.
            .replace(/^---\n[\s\S]*?\n---\n?/, "")
            // Public skill links resolve through the CLI's `/skill/<name>` route.
            .replace(/\]\((?!https?:\/\/)([^)#]+)\.md(#[^)]+)?\)/g, (_match, path, hash = "") => {
                return `](/skill/${basename(path)}${hash})`;
            })
    );
}
