import {DocumentationApiSchemaNode} from "~/shared/docs/documentation_api_model.js";

const idPatternPrefix = /^\^\[0-9abcdefgh/;

/**
 * A short human label for what kind of schema this is ("union · 13 variants",
 * "enum", "object", "id", …). Shown next to schema names in popovers and page
 * headers.
 */
export function getDocumentationApiSchemaKindLabel(node: DocumentationApiSchemaNode): string {
    if (node.oneOf !== undefined) return `union · ${node.oneOf.length} variants`;
    if (node.enum !== undefined) return "enum";
    if (node.type === "array") return "array";
    if (node.type === "object" || node.properties !== undefined) return "object";
    if (node.pattern !== undefined && idPatternPrefix.test(node.pattern)) return "id";
    if (typeof node.type === "string") return node.type;
    return "schema";
}
