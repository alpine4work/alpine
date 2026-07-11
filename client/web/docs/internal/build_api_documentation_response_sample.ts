import {
    DocumentationApiSchemaNode,
    resolveDocumentationApiSchemaNode,
} from "~/client/web/docs/documentation_api_model.js";

/**
 * One line of the response example. Lines with a `hintId` are interactive:
 * hovering them highlights the line and shows the matching field hint.
 */
export type DocumentationApiResponseSampleLine = {
    text: string;
    hintId: string | null;
};

export type DocumentationApiResponseSampleHint = {
    id: string;
    /** The JSON path to the field, e.g. `document.creator.from`. */
    path: string;
    name: string;
    required: boolean;
    description: string | null;
    /**
     * The field's unresolved schema node, rendered with `DocumentationApiTypeLabel`.
     */
    node: DocumentationApiSchemaNode;
};

export type DocumentationApiResponseSample = {
    lines: Array<DocumentationApiResponseSampleLine>;
    hints: Array<DocumentationApiResponseSampleHint>;
};

/**
 * Pretty-print a generated response sample value while walking its schema in
 * parallel, producing `JSON.stringify(value, null, 2)`-formatted lines where each
 * property line is annotated with a hint describing the field (type, required,
 * description). The walk is driven by the already depth-guarded sample value, so
 * it always terminates even though the schema graph is cyclic.
 */
export function buildDocumentationApiResponseSample(
    schemas: Record<string, DocumentationApiSchemaNode>,
    schema: DocumentationApiSchemaNode,
    value: unknown,
): DocumentationApiResponseSample {
    const hints: Array<DocumentationApiResponseSampleHint> = [];
    const hintIds = new Set<string>();

    function addHint({
        path,
        name,
        required,
        node,
    }: {
        path: string;
        name: string;
        required: boolean;
        node: DocumentationApiSchemaNode;
    }): string {
        if (!hintIds.has(path)) {
            hintIds.add(path);
            const {node: resolved} = resolveDocumentationApiSchemaNode(schemas, node);
            hints.push({
                id: path,
                path,
                name,
                required,
                description: node.description ?? resolved.description ?? null,
                node,
            });
        }
        return path;
    }

    /**
     * The object schema describing a sample object value. Resolves through `oneOf`
     * unions to the variant whose discriminator `const` matches the sample's `type` so
     * hints describe the variant that was generated.
     */
    function pickObjectNode(
        node: DocumentationApiSchemaNode | null,
        value: Record<string, unknown>,
    ): DocumentationApiSchemaNode | null {
        if (node === null) return null;
        const {node: resolved} = resolveDocumentationApiSchemaNode(schemas, node);
        if (resolved.oneOf === undefined) return resolved;

        const sampleTypeValue: unknown = value.type;
        for (const variant of resolved.oneOf) {
            if (variant.type === "null") continue;
            const {node: resolvedVariant} = resolveDocumentationApiSchemaNode(schemas, variant);
            const variantTypeConst = resolvedVariant.properties?.type?.const;
            if (typeof sampleTypeValue !== "string") return resolvedVariant;
            if (variantTypeConst === undefined || variantTypeConst === sampleTypeValue) {
                return resolvedVariant;
            }
        }

        return null;
    }

    function printValue({
        value,
        node,
        indent,
        prefix,
        hintId,
        path,
    }: {
        value: unknown;
        node: DocumentationApiSchemaNode | null;
        indent: number;
        prefix: string;
        hintId: string | null;
        path: string;
    }): Array<DocumentationApiResponseSampleLine> {
        const pad = "  ".repeat(indent);

        if (Array.isArray(value)) {
            if (value.length === 0) return [{text: `${pad}${prefix}[]`, hintId}];

            const resolved =
                node === null ? null : resolveDocumentationApiSchemaNode(schemas, node).node;
            const lines: Array<DocumentationApiResponseSampleLine> = [
                {text: `${pad}${prefix}[`, hintId},
            ];
            for (const [index, entry] of value.entries()) {
                const entryLines = printValue({
                    value: entry,
                    node: resolved?.items ?? null,
                    indent: indent + 1,
                    prefix: "",
                    hintId: null,
                    path: `${path}[]`,
                });
                if (index < value.length - 1) appendComma(entryLines);
                lines.push(...entryLines);
            }
            lines.push({text: `${pad}]`, hintId: null});
            return lines;
        }

        if (isPlainRecord(value)) {
            const entries = Object.entries(value);
            if (entries.length === 0) return [{text: `${pad}${prefix}{}`, hintId}];

            const lines: Array<DocumentationApiResponseSampleLine> = [
                {text: `${pad}${prefix}{`, hintId},
            ];
            const objectNode = pickObjectNode(node, value);
            const requiredNames = objectNode?.required ?? [];
            for (const [index, [key, entry]] of entries.entries()) {
                const propertyNode = objectNode?.properties?.[key] ?? null;
                const entryPath = path.length === 0 ? key : `${path}.${key}`;
                const entryHintId =
                    propertyNode === null
                        ? null
                        : addHint({
                              path: entryPath,
                              name: key,
                              required: requiredNames.includes(key),
                              node: propertyNode,
                          });
                const entryLines = printValue({
                    value: entry,
                    node: propertyNode,
                    indent: indent + 1,
                    prefix: `${JSON.stringify(key)}: `,
                    hintId: entryHintId,
                    path: entryPath,
                });
                if (index < entries.length - 1) appendComma(entryLines);
                lines.push(...entryLines);
            }
            lines.push({text: `${pad}}`, hintId: null});
            return lines;
        }

        return [{text: `${pad}${prefix}${JSON.stringify(value)}`, hintId}];
    }

    const lines = printValue({value, node: schema, indent: 0, prefix: "", hintId: null, path: ""});

    return {lines, hints};
}

function appendComma(lines: Array<DocumentationApiResponseSampleLine>) {
    const lastLine = lines[lines.length - 1];
    if (lastLine !== undefined) {
        lines[lines.length - 1] = {...lastLine, text: `${lastLine.text},`};
    }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}
