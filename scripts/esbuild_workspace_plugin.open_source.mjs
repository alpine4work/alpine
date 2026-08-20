import {existsSync} from "node:fs";
import {join} from "node:path";

/** Resolves Alpine's `~/` imports against the published workspace root. */
export function createEsbuildWorkspacePlugin(repositoryPath) {
    return {
        name: "alpine-workspace-source",
        setup(buildContext) {
            buildContext.onResolve({filter: /^~\//}, args => {
                const sourcePath = join(repositoryPath, args.path.slice(2));
                for (const candidatePath of sourceFileCandidates(sourcePath)) {
                    if (existsSync(candidatePath)) return {path: candidatePath};
                }
                throw new Error(`Missing published source for ${args.path}`);
            });
        },
    };
}

/**
 * Maps NodeNext JavaScript specifiers back to their published TypeScript source.
 */
function sourceFileCandidates(sourcePath) {
    const extensionReplacements = [
        [".jsx", [".tsx", ".ts", ".d.ts"]],
        [".mjs", [".mts", ".d.mts"]],
        [".cjs", [".cts", ".d.cts"]],
        [".js", [".ts", ".tsx", ".d.ts"]],
    ];
    for (const [extension, replacements] of extensionReplacements) {
        if (!sourcePath.endsWith(extension)) continue;
        const basePath = sourcePath.slice(0, -extension.length);
        return [...replacements.map(replacement => basePath + replacement), sourcePath];
    }
    return [sourcePath];
}
