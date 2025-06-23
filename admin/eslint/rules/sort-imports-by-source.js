"use strict";

module.exports = {
    meta: {
        schema: [],
        fixable: "code",
        messages: {
            sortImports: "Imports should be sorted alphabetically with `~/` imports at the end.",
            absoluteImport: "Instead of a relative imports use an absolute import with `~/`.",
            lineAfterSideEffects:
                "There must be a line between imports only for side-effects and other imports.",
        },
    },

    create(context) {
        function compareImportDeclarations(declarationA, declarationB) {
            const hasNoSpecifiersA = declarationA.specifiers.length === 0;
            const hasNoSpecifiersB = declarationB.specifiers.length === 0;

            if (hasNoSpecifiersA && !hasNoSpecifiersB) return -1;
            if (hasNoSpecifiersB && !hasNoSpecifiersA) return 1;

            return compareImportSources(declarationA.source.value, declarationB.source.value);
        }

        function compareImportSources(sourceA, sourceB) {
            const isOurSourceA = sourceA.startsWith("~/");
            const isOurSourceB = sourceB.startsWith("~/");

            if (isOurSourceA && !isOurSourceB) return 1;
            if (isOurSourceB && !isOurSourceA) return -1;

            if (isOurSourceA && isOurSourceB) return compareOurImportSources(sourceA, sourceB);

            if (sourceA < sourceB) return -1;
            if (sourceB < sourceA) return 1;

            return 0;
        }

        function compareOurImportSources(sourceA, sourceB) {
            const sourceSegmentsA = sourceA.split("/").map(s => s.toLowerCase());
            const sourceSegmentsB = sourceB.split("/").map(s => s.toLowerCase());
            const sourceLengthA = sourceSegmentsA.length;
            const sourceLengthB = sourceSegmentsB.length;
            const minLength = Math.min(sourceLengthA, sourceLengthB);

            for (let i = 0; i < minLength; i++) {
                const sourceSegmentA = sourceSegmentsA[i];
                const sourceSegmentB = sourceSegmentsB[i];

                if (sourceSegmentA < sourceSegmentB) return -1;
                if (sourceSegmentB < sourceSegmentA) return 1;
            }

            if (sourceLengthA < sourceLengthB) return -1;
            if (sourceLengthB < sourceLengthA) return 1;

            return 0;
        }

        let previousDeclaration = null;

        return {
            ImportDeclaration(node) {
                if (node.source.value.startsWith("./") || node.source.value.startsWith("../")) {
                    context.report({
                        node: node.source,
                        messageId: "absoluteImport",
                    });
                    return;
                }

                if (!previousDeclaration) {
                    previousDeclaration = node;
                    return;
                }

                if (
                    previousDeclaration.specifiers.length === 0 &&
                    node.specifiers.length !== 0 &&
                    previousDeclaration.loc.end.line + 1 >= node.loc.start.line
                ) {
                    context.report({
                        node,
                        messageId: "lineAfterSideEffects",
                    });
                }

                const ordering = compareImportDeclarations(node, previousDeclaration);

                if (ordering < 0) {
                    const adjacentDeclarations = [node];

                    if (node.parent && node.parent.type === "Program") {
                        const nodeIndex = node.parent.body.indexOf(node);
                        if (nodeIndex !== -1) {
                            for (let i = nodeIndex - 1; i >= 0; i--) {
                                const adjacentDeclaration = node.parent.body[i];
                                if (adjacentDeclaration.type === "ImportDeclaration") {
                                    adjacentDeclarations.push(adjacentDeclaration);
                                } else {
                                    break;
                                }
                            }

                            adjacentDeclarations.reverse();

                            for (let i = nodeIndex + 1; i < node.parent.body.length; i++) {
                                const adjacentDeclaration = node.parent.body[i];
                                if (adjacentDeclaration.type === "ImportDeclaration") {
                                    adjacentDeclarations.push(adjacentDeclaration);
                                } else {
                                    break;
                                }
                            }
                        }
                    }

                    if (adjacentDeclarations.length === 1) {
                        context.report({
                            node: node.source,
                            messageId: "sortImports",
                        });
                    } else {
                        context.report({
                            node: node.source,
                            messageId: "sortImports",
                            fix: fixer => {
                                const fullText = context.sourceCode.getText();

                                const initialComments = context.sourceCode.getCommentsBefore(
                                    adjacentDeclarations[0],
                                );

                                let lastIndex =
                                    initialComments.length > 0
                                        ? initialComments[0].range[0]
                                        : adjacentDeclarations[0].range[0];

                                const adjacentDeclarationsWithActualRanges =
                                    adjacentDeclarations.map(declaration => {
                                        const actualRange = [lastIndex, declaration.range[1]];
                                        lastIndex = actualRange[1];
                                        return {actualRange, declaration};
                                    });

                                const range = [
                                    adjacentDeclarationsWithActualRanges[0].actualRange[0],
                                    adjacentDeclarationsWithActualRanges[
                                        adjacentDeclarationsWithActualRanges.length - 1
                                    ].actualRange[1],
                                ];

                                const newText = adjacentDeclarationsWithActualRanges
                                    .sort((a, b) =>
                                        compareImportDeclarations(a.declaration, b.declaration),
                                    )
                                    .map(({actualRange: [startIndex, endIndex]}) =>
                                        fullText.slice(startIndex, endIndex).replace(/^\n/, ""),
                                    )
                                    .join("\n");

                                return fixer.replaceTextRange(range, newText);
                            },
                        });
                    }
                }

                previousDeclaration = node;
            },
        };
    },
};
