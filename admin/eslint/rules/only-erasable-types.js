"use strict";

module.exports = {
    meta: {
        schema: [],
        messages: {
            onlyErasableTypes:
                "Only types that are erased at runtime may go in a `types` directory.",
            mustUseTypeImport: "Imports outside of a `types` directory must be type imports.",
        },
    },

    create(context) {
        return {
            ":statement"(node) {
                const isErasableNode = node =>
                    node.type === "TSInterfaceDeclaration" ||
                    node.type === "TSTypeAliasDeclaration" ||
                    node.type === "TSTypeParameterDeclaration" ||
                    node.type === "TSModuleDeclaration" ||
                    node.type === "TSDeclareFunction" ||
                    (node.type === "VariableDeclaration" && node.declare);

                const isErasableType =
                    isErasableNode(node) ||
                    (node.type === "ExportNamedDeclaration" && isErasableNode(node.declaration));

                if (!isErasableType) {
                    if (node.type !== "ImportDeclaration") {
                        context.report({
                            node,
                            messageId: "onlyErasableTypes",
                        });
                    } else if (
                        !node.source.value.includes("/types/") &&
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
