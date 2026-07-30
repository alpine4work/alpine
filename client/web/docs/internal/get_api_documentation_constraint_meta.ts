import {
    DocumentationApiSchemaNode,
    getDocumentationApiSchemaRefName,
} from "~/client/web/docs/documentation_api_model.js";

const idPatternPrefix = /^\^\[0-9abcdefgh/;

/**
 * Small constraint descriptions rendered as meta pills next to a property's type
 * (pattern/format, min/max, default, const, …).
 */
export function getDocumentationApiConstraintMeta(
    schemas: Record<string, DocumentationApiSchemaNode>,
    node: DocumentationApiSchemaNode,
): Array<string> {
    // For `$ref` nodes only surface the well-known id/format constraints of the
    // referenced schema. Everything else is documented on the schema's own page.
    if (node.$ref !== undefined) {
        const referenced = schemas[getDocumentationApiSchemaRefName(node.$ref)];
        if (referenced === undefined) return [];
        if (referenced.pattern !== undefined && idPatternPrefix.test(referenced.pattern)) {
            return ["26-char base32 id"];
        }
        if (referenced.format !== undefined) return [referenced.format];
        return [];
    }

    const meta: Array<string> = [];

    if (node.format !== undefined) meta.push(node.format);

    if (node.pattern !== undefined) {
        if (idPatternPrefix.test(node.pattern)) {
            meta.push("26-char base32 id");
        } else {
            meta.push(
                `pattern ${node.pattern.length > 22 ? `${node.pattern.slice(0, 22)}…` : node.pattern}`,
            );
        }
    }

    if (node.const !== undefined) meta.push(`= ${JSON.stringify(node.const)}`);

    if (node.minLength !== undefined || node.maxLength !== undefined) {
        meta.push(`${node.minLength ?? 0}–${node.maxLength ?? "∞"} chars`);
    }

    if (node.minimum !== undefined || node.maximum !== undefined) {
        meta.push(`range ${node.minimum ?? "−∞"}–${node.maximum ?? "∞"}`);
    }

    if (node.minItems !== undefined || node.maxItems !== undefined) {
        meta.push(`${node.minItems ?? 0}–${node.maxItems ?? "∞"} items`);
    }

    if (node.default !== undefined) meta.push(`default ${JSON.stringify(node.default)}`);

    return meta;
}
