"use strict";

const fs = require("fs");
const path = require("path");

// Open-source files normally have to import other tagged files. This keeps the
// publication graph closed: when a tagged file is copied to the public repository,
// every workspace import it makes must have a corresponding tagged source file.
//
// A `.open_source.stub` file is the one exception: publication replaces its
// untagged counterpart at the same canonical import path. Discovering that
// counterpart from the filesystem keeps this rule aligned with the publication
// convention as stubs are added.
const openSourceStubExtensions = [
    ".d.ts",
    ".ts",
    ".tsx",
    ".mts",
    ".cts",
    ".js",
    ".jsx",
    ".mjs",
    ".cjs",
];
const openSourceStubCounterpartCache = new Map();

/**
 * Returns whether a workspace path belongs to the public source set.
 *
 * Directory tags are supported as well as file tags, so checking path segments
 * keeps this rule aligned with the publication manifest's selection rules.
 */
function isOpenSourcePath(filePath) {
    return filePath
        .replaceAll("\\", "/")
        .split("/")
        .some(segment => segment.includes(".open_source"));
}

/**
 * Stub files are publication-only replacements and must never be dependencies.
 */
function isOpenSourceStubPath(filePath) {
    return filePath
        .replaceAll("\\", "/")
        .split("/")
        .some(segment => segment.includes(".open_source.stub"));
}

/** Converts a workspace import into a workspace-relative path when possible. */
function resolveWorkspaceImportPath({moduleSpecifier, filename}) {
    const normalizedFilename = filename.replaceAll("\\", "/");
    const workspaceRelativeFilename = path.isAbsolute(filename)
        ? path.relative(process.cwd(), normalizedFilename).replaceAll("\\", "/")
        : normalizedFilename;

    if (moduleSpecifier.startsWith("~/")) return moduleSpecifier.slice(2);
    if (moduleSpecifier.startsWith("./") || moduleSpecifier.startsWith("../")) {
        return path.posix.normalize(
            path.posix.join(path.posix.dirname(workspaceRelativeFilename), moduleSpecifier),
        );
    }
    return undefined;
}

/** Removes the JavaScript/TypeScript extension used in an import specifier. */
function withoutSourceExtension(importPath) {
    return importPath.replace(/\.(?:d\.[cm]?ts|[cm]?js|[cm]?jsx|[cm]?ts|[cm]?tsx)$/u, "");
}

/**
 * Returns whether a private import has the public stub that replaces it during
 * publication.
 *
 * TypeScript workspace imports conventionally use `.js`, even when their source is
 * TypeScript, so check every source extension a stub may use rather than assuming
 * the import's extension.
 */
function hasOpenSourceStubCounterpart({moduleSpecifier, filename}) {
    const workspaceImportPath = resolveWorkspaceImportPath({moduleSpecifier, filename});
    if (workspaceImportPath === undefined) return false;

    const canonicalImportPath = withoutSourceExtension(workspaceImportPath);
    const cachedResult = openSourceStubCounterpartCache.get(canonicalImportPath);
    if (cachedResult !== undefined) return cachedResult;

    const hasStubCounterpart = openSourceStubExtensions.some(stubExtension =>
        fs.existsSync(
            path.resolve(process.cwd(), `${canonicalImportPath}.open_source.stub${stubExtension}`),
        ),
    );
    openSourceStubCounterpartCache.set(canonicalImportPath, hasStubCounterpart);
    return hasStubCounterpart;
}

function isOpenSourceStubImport({moduleSpecifier, filename}) {
    const workspaceImportPath = resolveWorkspaceImportPath({moduleSpecifier, filename});
    return workspaceImportPath !== undefined && isOpenSourceStubPath(workspaceImportPath);
}

/** Returns the canonical import path that a publication-only stub replaces. */
function stripOpenSourceStubTag(moduleSpecifier) {
    return moduleSpecifier.replaceAll(".open_source.stub", "");
}

function isWorkspaceImport(moduleSpecifier) {
    return (
        moduleSpecifier.startsWith("~/") ||
        moduleSpecifier.startsWith("./") ||
        moduleSpecifier.startsWith("../")
    );
}

function isTaggedOpenSourceImport({moduleSpecifier, filename}) {
    if (!isWorkspaceImport(moduleSpecifier)) return true;
    if (isOpenSourceStubImport({moduleSpecifier, filename})) return false;
    if (hasOpenSourceStubCounterpart({moduleSpecifier, filename})) return true;

    const workspaceImportPath = resolveWorkspaceImportPath({moduleSpecifier, filename});
    return workspaceImportPath !== undefined && isOpenSourcePath(workspaceImportPath);
}

module.exports = {
    meta: {
        fixable: "code",
        schema: [],
        messages: {
            stubImport:
                "Open-source files cannot import `.open_source.stub` files. Stub files are publication-only replacements; import the canonical path that the stub overwrites.",
            privateImport:
                "Open-source files may only import other `.open_source` files, except canonical paths replaced by an `.open_source.stub` file.",
            nonLiteralModuleSpecifier:
                "Open-source files cannot use non-literal module specifiers because their publication dependencies cannot be validated.",
        },
    },

    create(context) {
        const filename = context.getFilename();
        if (!isOpenSourcePath(filename)) return {};

        function checkImport(sourceNode) {
            const moduleSpecifier = sourceNode.value;
            if (
                typeof moduleSpecifier !== "string" ||
                isTaggedOpenSourceImport({moduleSpecifier, filename})
            ) {
                return;
            }

            context.report({
                node: sourceNode,
                messageId: isOpenSourceStubImport({moduleSpecifier, filename})
                    ? "stubImport"
                    : "privateImport",
                fix: isOpenSourceStubImport({moduleSpecifier, filename})
                    ? fixer => {
                          const sourceText = context.sourceCode.getText(sourceNode);
                          return fixer.replaceText(
                              sourceNode,
                              sourceText.replace(
                                  moduleSpecifier,
                                  stripOpenSourceStubTag(moduleSpecifier),
                              ),
                          );
                      }
                    : undefined,
            });
        }

        /** Reports module loading whose dependency cannot be resolved statically. */
        function checkModuleSpecifier(sourceNode) {
            if (sourceNode.type === "Literal") {
                checkImport(sourceNode);
                return;
            }

            context.report({node: sourceNode, messageId: "nonLiteralModuleSpecifier"});
        }

        return {
            ImportDeclaration(node) {
                checkImport(node.source);
            },
            ExportAllDeclaration(node) {
                checkImport(node.source);
            },
            ExportNamedDeclaration(node) {
                if (node.source) checkImport(node.source);
            },
            ImportExpression(node) {
                checkModuleSpecifier(node.source);
            },
            CallExpression(node) {
                if (
                    node.callee.type === "Identifier" &&
                    node.callee.name === "require" &&
                    node.arguments.length === 1
                ) {
                    checkModuleSpecifier(node.arguments[0]);
                }
            },
        };
    },
};
