"use strict";

const path = require("path");

// Use `process.cwd()` since ESLint is invoked with `cwd` set to the workspace root.
// We can't use `__dirname` because when loaded from `node_modules`, that path
// doesn't relate to the repo structure.
const repoDir = process.cwd();

module.exports = {
    meta: {
        schema: [],
        messages: {
            noInternalImport:
                "Can only import a module in an `internal` directory from within the directory or the parent directory.",
        },
    },

    create(context) {
        const ourPath = `./${path.relative(repoDir, context.getFilename())}`;

        return {
            ImportDeclaration(node) {
                if (
                    !node.source.value.startsWith("./") &&
                    !node.source.value.startsWith("../") &&
                    !node.source.value.startsWith("~/")
                ) {
                    return;
                }

                const importPath = node.source.value.startsWith("~/")
                    ? `./${node.source.value.slice(2)}`
                    : `./${path.relative(path.dirname(ourPath), node.source.value)}`;

                const internalPathSegment = "/internal/";
                let pathStartIndex = 0;
                let pathInternalIndex = importPath.indexOf(internalPathSegment);

                while (pathInternalIndex !== -1) {
                    // Reject an import: `~/foo/internal/bar`
                    // From: `~/qux/buz`
                    if (
                        ourPath.slice(pathStartIndex, pathInternalIndex) !==
                        importPath.slice(pathStartIndex, pathInternalIndex)
                    ) {
                        context.report({
                            node: node.source,
                            messageId: "noInternalImport",
                        });
                        break;
                    }

                    pathStartIndex = pathInternalIndex + internalPathSegment.length;
                    pathInternalIndex = importPath.indexOf(internalPathSegment, pathStartIndex);
                }
            },
        };
    },
};
