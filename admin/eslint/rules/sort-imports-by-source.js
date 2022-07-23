"use strict";

module.exports = {
    meta: {
        schema: [],
        messages: {
            sortImports: 'Imports should be sorted alphabetically with "~/" imports at the end.',
            absoluteImport: 'Instead of a relative imports use an absolute import with "~/".',
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
                    context.report({
                        node: node.source,
                        messageId: "sortImports",
                    });
                }

                previousDeclaration = node;
            },
        };
    },
};
