"use strict";

module.exports = {
    meta: {
        schema: [],
        messages: {
            onlyErasableTypes:
                'Only types that are erased at runtime may go in the "~/shared/types" directory.',
            mustUseTypeImport:
                'Imports outside of the "~/shared/types" directory must be type imports.',
        },
    },

    create(context) {
        return {
            [":statement"](node) {
                const isErasableType =
                    node.type === "TSInterfaceDeclaration" ||
                    node.type === "TSTypeAliasDeclaration" ||
                    (node.type === "ExportNamedDeclaration" &&
                        node.declaration.type === "TSInterfaceDeclaration") ||
                    (node.type === "ExportNamedDeclaration" &&
                        node.declaration.type === "TSTypeAliasDeclaration");

                if (!isErasableType) {
                    if (node.type !== "ImportDeclaration") {
                        context.report({
                            node,
                            messageId: "onlyErasableTypes",
                        });
                    } else if (
                        !node.source.value.startsWith("~/shared/types/") &&
                        node.importKind !== "type"
                    ) {
                        context.report({
                            node: node.source,
                            messageId: "mustUseTypeImport",
                        });
                    }
                }
            },
        };
    },
};
