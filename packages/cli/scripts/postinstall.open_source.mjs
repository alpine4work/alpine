import {spawnSync} from "node:child_process";
import {existsSync} from "node:fs";
import {dirname, join, relative, resolve} from "node:path";
import {fileURLToPath} from "node:url";

/**
 * npm runs this package's postinstall from the CLI directory, but hoists its dependencies into
 * the enclosing project's `node_modules`. Run patch-package from that project so it can find the
 * installed dependencies. The patch directory stays relative to the CLI package, which makes this
 * work for both a repository workspace and `npm install @alpine/cli`.
 */
const cliPackagePath = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const nodeModulesPath = findNodeModulesPath(cliPackagePath);

if (nodeModulesPath) {
    const installationPath = dirname(nodeModulesPath);
    const patchPackage = spawnSync(
        "patch-package",
        [
            "--patch-dir",
            relative(installationPath, join(cliPackagePath, "patches")),
            "--error-on-fail",
        ],
        {
            cwd: installationPath,
            env: {...process.env, NODE_ENV: "production"},
            stdio: "inherit",
        },
    );
    if (patchPackage.error) throw patchPackage.error;
    if (patchPackage.status !== 0) process.exitCode = patchPackage.status ?? 1;
}

function findNodeModulesPath(packagePath) {
    for (let searchPath = packagePath; ; searchPath = dirname(searchPath)) {
        const nodeModulesPath = join(searchPath, "node_modules");
        if (existsSync(nodeModulesPath)) return nodeModulesPath;

        const parentPath = dirname(searchPath);
        if (parentPath === searchPath) return undefined;
    }
}
