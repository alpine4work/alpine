"use strict";

module.exports = {
    meta: {
        schema: [],
        messages: {
            noModelInitialData:
                "Accessing the `initialData` property of models isn\u2019t allowed on the client as `initialData` won\u2019t be the latest data available on the client in realtime. Instead `initialData` is stale data loaded from the server. Instead get a `Store` from the corresponding registry class. You may then `useStore(store)` if you\u2019re in a React component to see new updates in realtime or `store.getSnapshot()` if you need the current value and don\u2019t care about future updates.",
        },
    },

    create(context) {
        const filename = context.getFilename().replace(/\\/g, "/");
        const isAppRoutesFile =
            filename.includes("/app/routes/") || filename.startsWith("app/routes/");

        function isInitialDataAssignment(node) {
            return (
                node.parent &&
                node.parent.type === "AssignmentExpression" &&
                node.parent.left === node &&
                node.parent.operator === "="
            );
        }

        function isInExportedRouteDataDeclaration(node) {
            let currentNode = node.parent;

            while (currentNode) {
                if (isExportedRouteDataFunctionDeclaration(currentNode)) {
                    return true;
                }

                if (isExportedRouteDataVariableDeclarator(currentNode)) return true;

                currentNode = currentNode.parent;
            }

            return false;
        }

        function isRouteDataDeclarationName(name) {
            return name === "loader" || name === "meta";
        }

        function isExportedRouteDataFunctionDeclaration(node) {
            return (
                node.type === "FunctionDeclaration" &&
                node.id &&
                isRouteDataDeclarationName(node.id.name) &&
                node.parent &&
                node.parent.type === "ExportNamedDeclaration"
            );
        }

        function isExportedRouteDataVariableDeclarator(node) {
            return (
                node.type === "VariableDeclarator" &&
                node.id.type === "Identifier" &&
                isRouteDataDeclarationName(node.id.name) &&
                node.parent &&
                node.parent.type === "VariableDeclaration" &&
                node.parent.parent &&
                node.parent.parent.type === "ExportNamedDeclaration"
            );
        }

        return {
            MemberExpression(node) {
                if (
                    !node.computed &&
                    node.property.type === "Identifier" &&
                    node.property.name === "initialData" &&
                    !isInitialDataAssignment(node) &&
                    !(isAppRoutesFile && isInExportedRouteDataDeclaration(node))
                ) {
                    context.report({
                        node: node.property,
                        messageId: "noModelInitialData",
                    });
                }
            },
        };
    },
};
