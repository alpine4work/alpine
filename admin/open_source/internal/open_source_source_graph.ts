/* eslint-disable cyberworlds/no-global-error -- Graph resolution errors include source paths. */

import * as fs from "node:fs";
import * as path from "node:path";

import * as ts from "typescript";

/**
 * Returns every module or path reference in a JavaScript or TypeScript source
 * file.
 */
function listOpenSourceModuleSpecifiers(source: string, sourceFilePath: string): Array<string> {
    const sourceFile = ts.createSourceFile(sourceFilePath, source, ts.ScriptTarget.Latest, false);
    const moduleSpecifiers = new Set<string>();

    function addOptionalStringLiteral(node: ts.Node | undefined): void {
        if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
            moduleSpecifiers.add(node.text);
        }
    }

    function addRequiredStringLiteral(node: ts.Node | undefined, loaderDescription: string): void {
        if (node && (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node))) {
            moduleSpecifiers.add(node.text);
            return;
        }
        throw new Error(
            `${sourceFilePath} uses a non-literal ${loaderDescription}. ` +
                "Open-source module references must be statically auditable.",
        );
    }

    function visit(node: ts.Node): void {
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
            addOptionalStringLiteral(node.moduleSpecifier);
        } else if (
            ts.isImportEqualsDeclaration(node) &&
            ts.isExternalModuleReference(node.moduleReference)
        ) {
            addRequiredStringLiteral(node.moduleReference.expression, "import assignment");
        } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
            addRequiredStringLiteral(node.argument.literal, "import type");
        } else if (ts.isCallExpression(node) && isTypeScriptModuleLoader(node.expression)) {
            addRequiredStringLiteral(node.arguments[0], moduleLoaderDescription(node.expression));
        } else if (
            ts.isNewExpression(node) &&
            ts.isIdentifier(node.expression) &&
            node.expression.text === "URL" &&
            node.arguments !== undefined &&
            node.arguments.length >= 2 &&
            node.arguments[1] !== undefined &&
            isImportMetaUrl(node.arguments[1])
        ) {
            addRequiredStringLiteral(node.arguments[0], "URL module reference");
        }
        ts.forEachChild(node, visit);
    }
    visit(sourceFile);

    for (const reference of sourceFile.referencedFiles) {
        moduleSpecifiers.add(reference.fileName);
    }
    return [...moduleSpecifiers].sort();
}

function moduleLoaderDescription(expression: ts.Expression): string {
    if (expression.kind === ts.SyntaxKind.ImportKeyword) return "dynamic import";
    if (ts.isIdentifier(expression)) return "require call";
    return "require.resolve call";
}

/** Resolves one workspace import to its private TypeScript source path. */
function resolveOpenSourceWorkspaceImport({
    moduleSpecifier,
    sourceRelativePath,
    workspacePath,
}: {
    moduleSpecifier: string;
    sourceRelativePath: string;
    workspacePath: string;
}): string | undefined {
    let unresolvedSourcePath;
    if (moduleSpecifier.startsWith("~/")) {
        unresolvedSourcePath = moduleSpecifier.slice(2);
    } else if (moduleSpecifier.startsWith("./") || moduleSpecifier.startsWith("../")) {
        unresolvedSourcePath = path.posix.join(
            path.posix.dirname(sourceRelativePath),
            moduleSpecifier,
        );
    } else {
        if (path.posix.isAbsolute(moduleSpecifier)) {
            throw new Error(
                `Absolute import \`${moduleSpecifier}\` in \`${sourceRelativePath}\` cannot be published`,
            );
        }
        return undefined;
    }

    for (const candidatePath of openSourceTypeScriptSourceCandidates(unresolvedSourcePath)) {
        assertSafeOpenSourceRelativePath(candidatePath, moduleSpecifier);
        if (isRegularFile(resolveWorkspaceFilePath(workspacePath, candidatePath))) {
            return candidatePath;
        }
    }
    throw new Error(
        `Could not resolve workspace import \`${moduleSpecifier}\` from \`${sourceRelativePath}\``,
    );
}

/**
 * Resolves a workspace import against the exact file set declared to Bazel.
 *
 * The archive action must not discover extra workspace files while it runs: doing
 * so would make its cache key depend on hidden filesystem state. When no declared
 * candidate exists, return the primary candidate so publication validation can
 * report it as an unselected import.
 */
function resolveOpenSourceDeclaredImport({
    availableSourcePaths,
    moduleSpecifier,
    sourceRelativePath,
}: {
    availableSourcePaths: ReadonlySet<string>;
    moduleSpecifier: string;
    sourceRelativePath: string;
}): string | undefined {
    const unresolvedSourcePath = unresolvedWorkspaceImportPath({
        moduleSpecifier,
        sourceRelativePath,
    });
    if (unresolvedSourcePath === undefined) return undefined;

    const candidatePaths = openSourceTypeScriptSourceCandidates(unresolvedSourcePath);
    for (const candidatePath of candidatePaths) {
        assertSafeOpenSourceRelativePath(candidatePath, moduleSpecifier);
        if (availableSourcePaths.has(candidatePath)) return candidatePath;
    }
    return candidatePaths[0];
}

/** Returns the workspace-relative path before extension substitution. */
function unresolvedWorkspaceImportPath({
    moduleSpecifier,
    sourceRelativePath,
}: {
    moduleSpecifier: string;
    sourceRelativePath: string;
}): string | undefined {
    if (moduleSpecifier.startsWith("~/")) return moduleSpecifier.slice(2);
    if (moduleSpecifier.startsWith("./") || moduleSpecifier.startsWith("../")) {
        return path.posix.join(path.posix.dirname(sourceRelativePath), moduleSpecifier);
    }
    if (path.posix.isAbsolute(moduleSpecifier)) {
        throw new Error(
            `Absolute import \`${moduleSpecifier}\` in \`${sourceRelativePath}\` cannot be published`,
        );
    }
    return undefined;
}

/** Lists source extensions that can satisfy a NodeNext JavaScript import. */
function openSourceTypeScriptSourceCandidates(unresolvedSourcePath: string): Array<string> {
    const extensionSubstitutions: ReadonlyArray<readonly [string, ReadonlyArray<string>]> = [
        [".jsx", [".tsx", ".ts", ".d.ts"]],
        [".mjs", [".mts", ".d.mts"]],
        [".cjs", [".cts", ".d.cts"]],
        [".js", [".ts", ".tsx", ".d.ts"]],
    ];
    for (const [extension, sourceExtensions] of extensionSubstitutions) {
        if (!unresolvedSourcePath.endsWith(extension)) continue;
        const baseSourcePath = unresolvedSourcePath.slice(0, -extension.length);
        return [
            ...sourceExtensions.map(sourceExtension => baseSourcePath + sourceExtension),
            unresolvedSourcePath,
        ];
    }
    return [
        unresolvedSourcePath,
        `${unresolvedSourcePath}.ts`,
        `${unresolvedSourcePath}.tsx`,
        `${unresolvedSourcePath}.d.ts`,
    ];
}

function isTypeScriptModuleLoader(expression: ts.Expression): boolean {
    return (
        expression.kind === ts.SyntaxKind.ImportKeyword ||
        (ts.isIdentifier(expression) && expression.text === "require") ||
        (ts.isPropertyAccessExpression(expression) &&
            ts.isIdentifier(expression.expression) &&
            expression.expression.text === "require" &&
            expression.name.text === "resolve")
    );
}

function isImportMetaUrl(node: ts.Node): boolean {
    return (
        ts.isPropertyAccessExpression(node) &&
        node.name.text === "url" &&
        ts.isMetaProperty(node.expression) &&
        node.expression.keywordToken === ts.SyntaxKind.ImportKeyword &&
        node.expression.name.text === "meta"
    );
}

function assertSafeOpenSourceRelativePath(filePath: string, description: string): void {
    if (
        filePath.length === 0 ||
        path.posix.isAbsolute(filePath) ||
        filePath.split("/").some(part => part.length === 0 || part === "." || part === "..")
    ) {
        throw new Error(`Unsafe workspace-relative source path: ${description}`);
    }
}

function resolveWorkspaceFilePath(workspacePath: string, relativeFilePath: string): string {
    const sourcePath = path.resolve(workspacePath, ...relativeFilePath.split("/"));
    const relativePath = path.relative(path.resolve(workspacePath), sourcePath);
    if (relativePath === "" || relativePath.startsWith("..") || path.isAbsolute(relativePath)) {
        throw new Error(`Open-source file escaped the workspace: ${relativeFilePath}`);
    }
    return sourcePath;
}

function isRegularFile(filePath: string): boolean {
    try {
        return fs.lstatSync(filePath).isFile();
    } catch (error) {
        if (
            typeof error === "object" &&
            error !== null &&
            "code" in error &&
            (error.code === "ENOENT" || error.code === "ENOTDIR")
        ) {
            return false;
        }
        throw error;
    }
}

export {
    listOpenSourceModuleSpecifiers,
    openSourceTypeScriptSourceCandidates,
    resolveOpenSourceDeclaredImport,
    resolveOpenSourceWorkspaceImport,
};
