import {parse} from "@babel/parser";
import {readFile, writeFile} from "fs/promises";
import {resolve as resolvePath} from "path";
import {parseArgs} from "util";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

type SortableDeclarationKind = "Function" | "Type" | "Variable";

type BabelNode = {
    readonly type: string;
    readonly start: number | null;
    readonly end: number | null;
    readonly loc?:
        | {
              readonly start: {
                  readonly line: number;
                  readonly column: number;
              };
              readonly end: {
                  readonly line: number;
                  readonly column: number;
              };
          }
        | undefined;
    readonly [key: string]: unknown;
};

type BabelFile = BabelNode & {
    readonly program: BabelProgram;
};

type BabelProgram = BabelNode & {
    readonly body: ReadonlyArray<BabelNode>;
};

type BabelIdentifier = BabelNode & {
    readonly type: "Identifier";
    readonly name: string;
};

type BabelFunctionDeclaration = BabelNode & {
    readonly type: "FunctionDeclaration";
    readonly id: BabelIdentifier | null;
    readonly params: ReadonlyArray<BabelNode>;
    readonly body: BabelNode;
    readonly returnType?: BabelNode | null;
    readonly typeParameters?: BabelNode | null;
};

type BabelVariableDeclaration = BabelNode & {
    readonly type: "VariableDeclaration";
    readonly declarations: ReadonlyArray<BabelVariableDeclarator>;
};

type BabelVariableDeclarator = BabelNode & {
    readonly type: "VariableDeclarator";
    readonly id: BabelNode;
};

type BabelExportNamedDeclaration = BabelNode & {
    readonly type: "ExportNamedDeclaration";
    readonly declaration: BabelNode | null;
};

type BabelExportDefaultDeclaration = BabelNode & {
    readonly type: "ExportDefaultDeclaration";
    readonly declaration: BabelNode;
};

type BabelTSTypeAliasDeclaration = BabelNode & {
    readonly type: "TSTypeAliasDeclaration";
    readonly id: BabelIdentifier;
};

type BabelTSInterfaceDeclaration = BabelNode & {
    readonly type: "TSInterfaceDeclaration";
    readonly id: BabelIdentifier;
};

type BabelTSTypeReference = BabelNode & {
    readonly type: "TSTypeReference";
    readonly typeName: BabelNode;
};

type BabelTSExpressionWithTypeArguments = BabelNode & {
    readonly type: "TSExpressionWithTypeArguments";
    readonly expression: BabelNode;
};

type SortableDeclaration = {
    readonly kind: SortableDeclarationKind;
    readonly name: string;
    readonly isExported: boolean;
    readonly originalIndex: number;
    readonly statementNode: BabelNode;
    readonly declarationNode:
        | BabelFunctionDeclaration
        | BabelVariableDeclaration
        | BabelTSTypeAliasDeclaration
        | BabelTSInterfaceDeclaration;
    readonly chunkStart: number;
    readonly chunkEnd: number;
};

type WalkContext = {
    readonly node: BabelNode;
    readonly parentNode: BabelNode | null;
    readonly parentKey: string | null;
    readonly ancestorNodes: ReadonlyArray<BabelNode>;
};

const ignoredTraversalKeys = new Set([
    "end",
    "extra",
    "innerComments",
    "leadingComments",
    "loc",
    "range",
    "start",
    "trailingComments",
]);

/**
 * Reorders top-level TypeScript declarations by reference graph.
 *
 * The output preserves each declaration's original source text verbatim. Only the
 * order of top-level declarations changes.
 */
export function sortTypescriptReferenceGraphSource(
    source: string,
    filePathForErrors: string,
): string {
    const file = parseTypescriptModule({
        source,
        filePathForErrors,
    });
    const {headerEnd, declarations} = extractSortableDeclarations({
        file,
        filePathForErrors,
    });

    if (declarations.length <= 1) return source;

    const valueDeclarations = declarations.filter(
        declaration => declaration.kind === "Function" || declaration.kind === "Variable",
    );
    const variableDeclarations = declarations.filter(
        declaration => declaration.kind === "Variable",
    );
    const typeDeclarations = declarations.filter(declaration => declaration.kind === "Type");

    const valueByName = createDeclarationMap(valueDeclarations, filePathForErrors);
    const variableByName = createDeclarationMap(variableDeclarations, filePathForErrors);
    const typeByName = createDeclarationMap(typeDeclarations, filePathForErrors);
    const valueNames = new Set(valueByName.keys());
    const variableNames = new Set(variableByName.keys());
    const typeNames = new Set(typeByName.keys());

    const referencedValueNamesByValueName = new Map<string, Array<string>>();
    for (const declaration of valueDeclarations) {
        referencedValueNamesByValueName.set(
            declaration.name,
            collectReferencedValueNames({
                rootNode: declaration.declarationNode,
                valueNames,
            }),
        );
    }

    const referencedVariableNamesBeforeValueName = new Map<string, Array<string>>();
    for (const declaration of valueDeclarations) {
        referencedVariableNamesBeforeValueName.set(
            declaration.name,
            collectReferencedVariableNamesBeforeValue({
                declaration,
                valueNames: variableNames,
            }),
        );
    }

    const referencedTypeNamesBeforeValueName = new Map<string, Array<string>>();
    const referencedTypeNamesAfterValueName = new Map<string, Array<string>>();
    for (const declaration of valueDeclarations) {
        referencedTypeNamesBeforeValueName.set(
            declaration.name,
            collectReferencedTypeNamesBeforeValue({
                declaration,
                typeNames,
            }),
        );
        referencedTypeNamesAfterValueName.set(
            declaration.name,
            collectReferencedTypeNamesAfterValue({
                declaration,
                typeNames,
            }),
        );
    }

    const referencedTypeNamesByTypeName = new Map<string, Array<string>>();
    for (const declaration of typeDeclarations) {
        referencedTypeNamesByTypeName.set(
            declaration.name,
            collectReferencedTypeNames({
                rootNode: declaration.declarationNode,
                typeNames,
            }).filter(typeName => typeName !== declaration.name),
        );
    }

    const orderedValueNames = orderValuesByReferenceGraph({
        valueDeclarations,
        referencedValueNamesByValueName,
    });

    const orderedDeclarations: Array<SortableDeclaration> = [];
    const emittedValueNames = new Set<string>();
    const emittedTypeNames = new Set<string>();
    const visitingValueNames = new Set<string>();

    for (const valueName of orderedValueNames) {
        emitValueDeclaration({
            valueName,
            orderedDeclarations,
            emittedValueNames,
            emittedTypeNames,
            visitingValueNames,
            valueByName,
            variableByName,
            referencedVariableNamesBeforeValueName,
            typeByName,
            referencedTypeNamesBeforeValueName,
            referencedTypeNamesAfterValueName,
            referencedTypeNamesByTypeName,
        });
    }

    for (const declaration of typeDeclarations) {
        emitTypeDeclarations({
            orderedDeclarations,
            emittedTypeNames,
            typeByName,
            referencedTypeNamesByTypeName,
            typeName: declaration.name,
        });
    }

    assert(
        orderedDeclarations.length === declarations.length,
        "The reference graph sort did not emit every top-level declaration",
    );

    const declarationChunks = declarations.map((declaration, declarationIndex) => {
        const chunkStart =
            declarationIndex === 0
                ? headerEnd
                : declarations[declarationIndex - 1]!.statementNode.end!;
        return source.slice(chunkStart, declaration.chunkEnd);
    });

    const declarationChunkByKey = new Map<string, string>();
    for (const declaration of declarations) {
        declarationChunkByKey.set(
            getDeclarationKey(declaration),
            declarationChunks[declaration.originalIndex]!,
        );
    }

    return [
        source.slice(0, headerEnd),
        joinDeclarationChunks(
            orderedDeclarations.map(
                declaration => declarationChunkByKey.get(getDeclarationKey(declaration))!,
            ),
        ),
        source.slice(declarations[declarations.length - 1]!.chunkEnd),
    ].join("");
}

async function main() {
    const {
        values: {check, help},
        positionals,
    } = parseArgs({
        allowPositionals: true,
        options: {
            check: {
                type: "boolean",
                default: false,
            },
            help: {
                type: "boolean",
                short: "h",
                default: false,
            },
        },
    });

    if (help) {
        // eslint-disable-next-line no-console
        console.log(
            [
                "Usage:",
                "    dev experimental sort-reference-graph <file> [--check]",
                "",
                "Examples:",
                "    dev experimental sort-reference-graph " +
                    "shared/prosemirror/diff_prosemirror_nodes.ts",
                "    dev experimental sort-reference-graph " +
                    "shared/prosemirror/diff_prosemirror_nodes.ts --check",
            ].join("\n"),
        );
        return;
    }

    assert(
        positionals.length === 1,
        "Usage: dev experimental sort-reference-graph <file> [--check]",
    );

    const workspacePath = process.env.BUILD_WORKSPACE_DIRECTORY ?? process.cwd();
    const filePath = resolvePath(workspacePath, positionals[0]!);
    const source = await readFile(filePath, "utf8");
    const sortedSource = sortTypescriptReferenceGraphSource(source, filePath);

    if (check) {
        assert(source === sortedSource, `${filePath} is not in reference graph order`);
        return;
    }

    if (source !== sortedSource) {
        await writeFile(filePath, sortedSource);
    }

    // eslint-disable-next-line no-console
    console.log(
        source === sortedSource ? `Already sorted ${positionals[0]!}` : `Sorted ${positionals[0]!}`,
    );
}

function parseTypescriptModule({
    source,
    filePathForErrors,
}: {
    source: string;
    filePathForErrors: string;
}): BabelFile {
    return parse(source, {
        sourceFilename: filePathForErrors,
        sourceType: "module",
        plugins: filePathForErrors.endsWith(".tsx") ? ["jsx", "typescript"] : ["typescript"],
    }) as unknown as BabelFile;
}

function extractSortableDeclarations({
    file,
    filePathForErrors,
}: {
    file: BabelFile;
    filePathForErrors: string;
}): {
    readonly headerEnd: number;
    readonly declarations: Array<SortableDeclaration>;
} {
    const declarations: Array<Omit<SortableDeclaration, "chunkStart" | "chunkEnd">> = [];
    let headerEnd = 0;
    let sawFirstNonImportStatement = false;

    for (const statementNode of file.program.body) {
        if (statementNode.type === "ImportDeclaration") {
            assert(
                !sawFirstNonImportStatement,
                createUnsupportedTopLevelStatementError({
                    filePathForErrors,
                    statementNode,
                    reason: "Imports must appear before the sortable declarations",
                }),
            );
            headerEnd = statementNode.end!;
            continue;
        }

        sawFirstNonImportStatement = true;

        const declaration = createSortableDeclaration({
            statementNode,
            originalIndex: declarations.length,
            filePathForErrors,
        });

        assert(
            declaration !== null,
            createUnsupportedTopLevelStatementError({
                filePathForErrors,
                statementNode,
                reason:
                    "Only top-level function declarations, variable declarations, type " +
                    "aliases, and interfaces are supported",
            }),
        );

        declarations.push(declaration);
    }

    return {
        headerEnd,
        declarations: declarations.map((declaration, declarationIndex) => ({
            ...declaration,
            chunkStart:
                declarationIndex === 0
                    ? headerEnd
                    : declarations[declarationIndex - 1]!.statementNode.end!,
            chunkEnd: declaration.statementNode.end!,
        })),
    };
}

function createSortableDeclaration({
    statementNode,
    originalIndex,
    filePathForErrors,
}: {
    statementNode: BabelNode;
    originalIndex: number;
    filePathForErrors: string;
}): Omit<SortableDeclaration, "chunkStart" | "chunkEnd"> | null {
    let isExported = false;
    let declarationNode = statementNode;

    switch (statementNode.type) {
        case "ExportNamedDeclaration": {
            isExported = true;
            declarationNode = (statementNode as BabelExportNamedDeclaration).declaration!;
            assert(
                declarationNode !== null,
                createUnsupportedTopLevelStatementError({
                    filePathForErrors,
                    statementNode,
                    reason: "Re-export statements are not supported",
                }),
            );
            break;
        }
        case "ExportDefaultDeclaration": {
            isExported = true;
            declarationNode = (statementNode as BabelExportDefaultDeclaration).declaration;
            break;
        }
        default:
            break;
    }

    if (isFunctionDeclaration(declarationNode)) {
        assert(
            declarationNode.id !== null,
            createUnsupportedTopLevelStatementError({
                filePathForErrors,
                statementNode,
                reason: "Anonymous top-level functions are not supported",
            }),
        );
        return {
            kind: "Function",
            name: declarationNode.id.name,
            isExported,
            originalIndex,
            statementNode,
            declarationNode,
        };
    }

    if (isVariableDeclaration(declarationNode)) {
        return {
            kind: "Variable",
            name: getVariableDeclarationName({
                statementNode,
                variableDeclarationNode: declarationNode,
                filePathForErrors,
            }),
            isExported,
            originalIndex,
            statementNode,
            declarationNode,
        };
    }

    if (isTypeDeclaration(declarationNode)) {
        return {
            kind: "Type",
            name: declarationNode.id.name,
            isExported,
            originalIndex,
            statementNode,
            declarationNode,
        };
    }

    return null;
}

function createDeclarationMap(
    declarations: ReadonlyArray<SortableDeclaration>,
    filePathForErrors: string,
): Map<string, SortableDeclaration> {
    const declarationByName = new Map<string, SortableDeclaration>();

    for (const declaration of declarations) {
        assert(
            !declarationByName.has(declaration.name),
            `${filePathForErrors} has multiple top-level declarations named ` +
                `${declaration.name}`,
        );
        declarationByName.set(declaration.name, declaration);
    }

    return declarationByName;
}

function orderValuesByReferenceGraph({
    valueDeclarations,
    referencedValueNamesByValueName,
}: {
    valueDeclarations: ReadonlyArray<SortableDeclaration>;
    referencedValueNamesByValueName: ReadonlyMap<string, ReadonlyArray<string>>;
}): Array<string> {
    const orderedValueNames: Array<string> = [];
    const visitedValueNames = new Set<string>();

    const rootValueNames = [
        ...valueDeclarations
            .filter(declaration => declaration.isExported)
            .map(declaration => declaration.name),
        ...valueDeclarations
            .filter(declaration => !declaration.isExported)
            .map(declaration => declaration.name),
    ];

    for (const rootValueName of rootValueNames) {
        visitValue({
            valueName: rootValueName,
            orderedValueNames,
            visitedValueNames,
            referencedValueNamesByValueName,
        });
    }

    return orderedValueNames;
}

function visitValue({
    valueName,
    orderedValueNames,
    visitedValueNames,
    referencedValueNamesByValueName,
}: {
    valueName: string;
    orderedValueNames: Array<string>;
    visitedValueNames: Set<string>;
    referencedValueNamesByValueName: ReadonlyMap<string, ReadonlyArray<string>>;
}) {
    if (visitedValueNames.has(valueName)) return;

    visitedValueNames.add(valueName);
    orderedValueNames.push(valueName);

    for (const referencedValueName of referencedValueNamesByValueName.get(valueName) ?? []) {
        visitValue({
            valueName: referencedValueName,
            orderedValueNames,
            visitedValueNames,
            referencedValueNamesByValueName,
        });
    }
}

function emitValueDeclaration({
    valueName,
    orderedDeclarations,
    emittedValueNames,
    emittedTypeNames,
    visitingValueNames,
    valueByName,
    variableByName,
    referencedVariableNamesBeforeValueName,
    typeByName,
    referencedTypeNamesBeforeValueName,
    referencedTypeNamesAfterValueName,
    referencedTypeNamesByTypeName,
}: {
    valueName: string;
    orderedDeclarations: Array<SortableDeclaration>;
    emittedValueNames: Set<string>;
    emittedTypeNames: Set<string>;
    visitingValueNames: Set<string>;
    valueByName: ReadonlyMap<string, SortableDeclaration>;
    variableByName: ReadonlyMap<string, SortableDeclaration>;
    referencedVariableNamesBeforeValueName: ReadonlyMap<string, ReadonlyArray<string>>;
    typeByName: ReadonlyMap<string, SortableDeclaration>;
    referencedTypeNamesBeforeValueName: ReadonlyMap<string, ReadonlyArray<string>>;
    referencedTypeNamesAfterValueName: ReadonlyMap<string, ReadonlyArray<string>>;
    referencedTypeNamesByTypeName: ReadonlyMap<string, ReadonlyArray<string>>;
}) {
    if (emittedValueNames.has(valueName)) return;
    if (visitingValueNames.has(valueName)) return;

    visitingValueNames.add(valueName);

    for (const typeName of referencedTypeNamesBeforeValueName.get(valueName) ?? []) {
        emitTypeDeclarations({
            orderedDeclarations,
            emittedTypeNames,
            typeByName,
            referencedTypeNamesByTypeName,
            typeName,
        });
    }

    for (const referencedVariableName of referencedVariableNamesBeforeValueName.get(valueName) ??
        []) {
        emitVariableDeclaration({
            variableName: referencedVariableName,
            orderedDeclarations,
            emittedValueNames,
            emittedTypeNames,
            visitingValueNames,
            variableByName,
            referencedVariableNamesBeforeValueName,
            typeByName,
            referencedTypeNamesBeforeValueName,
            referencedTypeNamesByTypeName,
        });
    }

    visitingValueNames.delete(valueName);
    emittedValueNames.add(valueName);
    orderedDeclarations.push(valueByName.get(valueName)!);

    for (const typeName of referencedTypeNamesAfterValueName.get(valueName) ?? []) {
        emitTypeDeclarations({
            orderedDeclarations,
            emittedTypeNames,
            typeByName,
            referencedTypeNamesByTypeName,
            typeName,
        });
    }
}

function emitVariableDeclaration({
    variableName,
    orderedDeclarations,
    emittedValueNames,
    emittedTypeNames,
    visitingValueNames,
    variableByName,
    referencedVariableNamesBeforeValueName,
    typeByName,
    referencedTypeNamesBeforeValueName,
    referencedTypeNamesByTypeName,
}: {
    variableName: string;
    orderedDeclarations: Array<SortableDeclaration>;
    emittedValueNames: Set<string>;
    emittedTypeNames: Set<string>;
    visitingValueNames: Set<string>;
    variableByName: ReadonlyMap<string, SortableDeclaration>;
    referencedVariableNamesBeforeValueName: ReadonlyMap<string, ReadonlyArray<string>>;
    typeByName: ReadonlyMap<string, SortableDeclaration>;
    referencedTypeNamesBeforeValueName: ReadonlyMap<string, ReadonlyArray<string>>;
    referencedTypeNamesByTypeName: ReadonlyMap<string, ReadonlyArray<string>>;
}) {
    if (emittedValueNames.has(variableName)) return;
    if (visitingValueNames.has(variableName)) return;

    visitingValueNames.add(variableName);

    for (const typeName of referencedTypeNamesBeforeValueName.get(variableName) ?? []) {
        emitTypeDeclarations({
            orderedDeclarations,
            emittedTypeNames,
            typeByName,
            referencedTypeNamesByTypeName,
            typeName,
        });
    }

    for (const referencedVariableName of referencedVariableNamesBeforeValueName.get(variableName) ??
        []) {
        emitVariableDeclaration({
            variableName: referencedVariableName,
            orderedDeclarations,
            emittedValueNames,
            emittedTypeNames,
            visitingValueNames,
            variableByName,
            referencedVariableNamesBeforeValueName,
            typeByName,
            referencedTypeNamesBeforeValueName,
            referencedTypeNamesByTypeName,
        });
    }

    visitingValueNames.delete(variableName);
    emittedValueNames.add(variableName);
    orderedDeclarations.push(variableByName.get(variableName)!);
}

function emitTypeDeclarations({
    orderedDeclarations,
    emittedTypeNames,
    typeByName,
    referencedTypeNamesByTypeName,
    typeName,
}: {
    orderedDeclarations: Array<SortableDeclaration>;
    emittedTypeNames: Set<string>;
    typeByName: ReadonlyMap<string, SortableDeclaration>;
    referencedTypeNamesByTypeName: ReadonlyMap<string, ReadonlyArray<string>>;
    typeName: string;
}) {
    if (emittedTypeNames.has(typeName)) return;

    emittedTypeNames.add(typeName);
    orderedDeclarations.push(typeByName.get(typeName)!);

    for (const referencedTypeName of referencedTypeNamesByTypeName.get(typeName) ?? []) {
        emitTypeDeclarations({
            orderedDeclarations,
            emittedTypeNames,
            typeByName,
            referencedTypeNamesByTypeName,
            typeName: referencedTypeName,
        });
    }
}

function collectReferencedVariableNamesBeforeValue({
    declaration,
    valueNames,
}: {
    declaration: SortableDeclaration;
    valueNames: ReadonlySet<string>;
}): Array<string> {
    if (isExportedFunctionDeclaration(declaration)) {
        return collectReferencedValueNamesFromNodes({
            rootNodes: getFunctionSignatureRootNodes(declaration.declarationNode),
            valueNames,
        });
    }

    return collectReferencedValueNames({
        rootNode: declaration.declarationNode,
        valueNames,
    });
}

function collectReferencedTypeNamesBeforeValue({
    declaration,
    typeNames,
}: {
    declaration: SortableDeclaration;
    typeNames: ReadonlySet<string>;
}): Array<string> {
    if (isExportedFunctionDeclaration(declaration)) {
        return collectReferencedTypeNamesFromNodes({
            rootNodes: getFunctionSignatureRootNodes(declaration.declarationNode),
            typeNames,
        });
    }

    return collectReferencedTypeNames({
        rootNode: declaration.declarationNode,
        typeNames,
    });
}

function collectReferencedTypeNamesAfterValue({
    declaration,
    typeNames,
}: {
    declaration: SortableDeclaration;
    typeNames: ReadonlySet<string>;
}): Array<string> {
    if (!isExportedFunctionDeclaration(declaration)) return [];

    return collectReferencedTypeNamesFromNodes({
        rootNodes: getFunctionBodyRootNodes(declaration.declarationNode),
        typeNames,
    });
}

function collectReferencedValueNames({
    rootNode,
    valueNames,
}: {
    rootNode: BabelNode;
    valueNames: ReadonlySet<string>;
}): Array<string> {
    return collectReferencedValueNamesFromNodes({
        rootNodes: [rootNode],
        valueNames,
    });
}

function collectReferencedValueNamesFromNodes({
    rootNodes,
    valueNames,
}: {
    rootNodes: ReadonlyArray<BabelNode>;
    valueNames: ReadonlySet<string>;
}): Array<string> {
    return collectOrderedUniqueNames({
        rootNodes,
        names: valueNames,
        matcher(context) {
            const {node} = context;
            if (node.type !== "Identifier") return null;
            if (!isValueReferenceIdentifier(context)) return null;

            return (node as BabelIdentifier).name;
        },
    });
}

function collectReferencedTypeNames({
    rootNode,
    typeNames,
}: {
    rootNode: BabelNode;
    typeNames: ReadonlySet<string>;
}): Array<string> {
    return collectReferencedTypeNamesFromNodes({
        rootNodes: [rootNode],
        typeNames,
    });
}

function collectReferencedTypeNamesFromNodes({
    rootNodes,
    typeNames,
}: {
    rootNodes: ReadonlyArray<BabelNode>;
    typeNames: ReadonlySet<string>;
}): Array<string> {
    return collectOrderedUniqueNames({
        rootNodes,
        names: typeNames,
        matcher({node}) {
            switch (node.type) {
                case "TSExpressionWithTypeArguments":
                    return getIdentifierName(
                        (node as BabelTSExpressionWithTypeArguments).expression,
                    );
                case "TSTypeReference":
                    return getIdentifierName((node as BabelTSTypeReference).typeName);
                default:
                    return null;
            }
        },
    });
}

function collectOrderedUniqueNames({
    rootNodes,
    names,
    matcher,
}: {
    rootNodes: ReadonlyArray<BabelNode>;
    names: ReadonlySet<string>;
    matcher: (context: WalkContext) => string | null;
}): Array<string> {
    const orderedNames: Array<{readonly name: string; readonly start: number}> = [];
    const seenNames = new Set<string>();

    for (const rootNode of rootNodes) {
        walkNode(rootNode, {
            onNode(context) {
                const matchedName = matcher(context);
                if (matchedName === null) return;
                if (!names.has(matchedName)) return;
                if (seenNames.has(matchedName)) return;

                seenNames.add(matchedName);
                orderedNames.push({
                    name: matchedName,
                    start: context.node.start ?? -1,
                });
            },
        });
    }

    orderedNames.sort((name1, name2) => name1.start - name2.start);

    return orderedNames.map(({name}) => name);
}

function getFunctionSignatureRootNodes(
    functionDeclarationNode: BabelFunctionDeclaration,
): Array<BabelNode> {
    return [
        ...(functionDeclarationNode.typeParameters === undefined ||
        functionDeclarationNode.typeParameters === null
            ? []
            : [functionDeclarationNode.typeParameters]),
        ...functionDeclarationNode.params,
        ...(functionDeclarationNode.returnType === undefined ||
        functionDeclarationNode.returnType === null
            ? []
            : [functionDeclarationNode.returnType]),
    ];
}

function getFunctionBodyRootNodes(
    functionDeclarationNode: BabelFunctionDeclaration,
): Array<BabelNode> {
    return [functionDeclarationNode.body];
}

function isExportedFunctionDeclaration(
    declaration: SortableDeclaration,
): declaration is SortableDeclaration & {readonly declarationNode: BabelFunctionDeclaration} {
    return declaration.isExported && isFunctionDeclaration(declaration.declarationNode);
}

function walkNode(
    node: BabelNode,
    {
        onNode,
        parentNode = null,
        parentKey = null,
        ancestorNodes = [],
    }: {
        onNode: (context: WalkContext) => void;
        parentNode?: BabelNode | null;
        parentKey?: string | null;
        ancestorNodes?: ReadonlyArray<BabelNode>;
    },
) {
    onNode({
        node,
        parentNode,
        parentKey,
        ancestorNodes,
    });

    for (const [key, value] of Object.entries(node)) {
        if (ignoredTraversalKeys.has(key)) continue;
        walkValue(value, {
            onNode,
            parentNode: node,
            parentKey: key,
            ancestorNodes: [...ancestorNodes, node],
        });
    }
}

function walkValue(
    value: unknown,
    {
        onNode,
        parentNode,
        parentKey,
        ancestorNodes,
    }: {
        onNode: (context: WalkContext) => void;
        parentNode: BabelNode;
        parentKey: string;
        ancestorNodes: ReadonlyArray<BabelNode>;
    },
) {
    if (Array.isArray(value)) {
        for (const item of value) {
            walkValue(item, {
                onNode,
                parentNode,
                parentKey,
                ancestorNodes,
            });
        }
        return;
    }

    if (!isBabelNode(value)) return;

    walkNode(value, {
        onNode,
        parentNode,
        parentKey,
        ancestorNodes,
    });
}

function getIdentifierName(node: BabelNode): string | null {
    if (node.type === "Identifier") {
        return (node as BabelIdentifier).name;
    }
    return null;
}

function joinDeclarationChunks(chunks: ReadonlyArray<string>): string {
    let source = "";

    for (const chunk of chunks) {
        if (source.length > 0 && !source.endsWith("\n") && !chunk.startsWith("\n")) {
            source += "\n\n";
        }

        source += chunk;
    }

    return source;
}

function getDeclarationKey(declaration: SortableDeclaration): string {
    return `${declaration.kind}:${declaration.name}`;
}

function getVariableDeclarationName({
    statementNode,
    variableDeclarationNode,
    filePathForErrors,
}: {
    statementNode: BabelNode;
    variableDeclarationNode: BabelVariableDeclaration;
    filePathForErrors: string;
}): string {
    assert(
        variableDeclarationNode.declarations.length === 1,
        createUnsupportedTopLevelStatementError({
            filePathForErrors,
            statementNode,
            reason: "Top-level variable declarations must declare exactly one binding",
        }),
    );

    const variableDeclarator = variableDeclarationNode.declarations[0]!;

    assert(
        variableDeclarator.id.type === "Identifier",
        createUnsupportedTopLevelStatementError({
            filePathForErrors,
            statementNode,
            reason: "Top-level variable declarations must use identifier bindings",
        }),
    );

    return (variableDeclarator.id as BabelIdentifier).name;
}

function isBabelNode(value: unknown): value is BabelNode {
    return (
        typeof value === "object" &&
        value !== null &&
        "type" in value &&
        typeof value.type === "string" &&
        "start" in value &&
        "end" in value
    );
}

function isFunctionDeclaration(node: BabelNode): node is BabelFunctionDeclaration {
    return node.type === "FunctionDeclaration";
}

function isVariableDeclaration(node: BabelNode): node is BabelVariableDeclaration {
    return node.type === "VariableDeclaration";
}

function isValueReferenceIdentifier({parentNode, parentKey, ancestorNodes}: WalkContext): boolean {
    if (parentNode === null || parentKey === null) return false;
    if (isTypeOnlyNode(parentNode)) return false;

    const grandparentNode = ancestorNodes.at(-2) ?? null;

    switch (parentNode.type) {
        case "ArrayPattern":
        case "CatchClause":
        case "ContinueStatement":
        case "BreakStatement":
        case "ExportSpecifier":
        case "ImportDefaultSpecifier":
        case "ImportNamespaceSpecifier":
        case "ImportSpecifier":
        case "LabeledStatement":
        case "ObjectPattern":
        case "RestElement":
            return false;
        case "ArrowFunctionExpression":
        case "FunctionDeclaration":
        case "FunctionExpression":
            return parentKey !== "id" && parentKey !== "params";
        case "AssignmentPattern":
            return parentKey !== "left";
        case "ClassDeclaration":
        case "ClassExpression":
            return parentKey !== "id";
        case "ClassMethod":
        case "ClassPrivateMethod":
        case "ObjectMethod":
            return parentKey !== "key" && parentKey !== "params";
        case "MemberExpression":
        case "OptionalMemberExpression":
            return parentKey !== "property" || Boolean(parentNode["computed"]);
        case "ObjectProperty":
            if (grandparentNode?.type === "ObjectPattern") return false;
            return parentKey !== "key" || Boolean(parentNode["computed"]);
        case "VariableDeclarator":
            return parentKey !== "id";
        default:
            return true;
    }
}

function isTypeOnlyNode(node: BabelNode): boolean {
    if (!node.type.startsWith("TS")) return false;

    switch (node.type) {
        case "TSAsExpression":
        case "TSInstantiationExpression":
        case "TSNonNullExpression":
        case "TSSatisfiesExpression":
            return false;
        default:
            return true;
    }
}

function isTypeDeclaration(
    node: BabelNode,
): node is BabelTSTypeAliasDeclaration | BabelTSInterfaceDeclaration {
    return node.type === "TSTypeAliasDeclaration" || node.type === "TSInterfaceDeclaration";
}

function createUnsupportedTopLevelStatementError({
    filePathForErrors,
    statementNode,
    reason,
}: {
    filePathForErrors: string;
    statementNode: BabelNode;
    reason: string;
}): string {
    const line = statementNode.loc?.start.line;
    return line === undefined
        ? `${filePathForErrors}: ${reason}`
        : `${filePathForErrors}:${line}: ${reason}`;
}

main().then(
    () => {
        process.exitCode = 0;
    },
    error => {
        // eslint-disable-next-line no-console
        console.error(error);
        process.exitCode = 1;
    },
);
