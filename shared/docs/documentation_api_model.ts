/**
 * The data model for the generated API reference docs. Built once on the server by
 * parsing our OpenAPI specification (`api_specification_final.yaml`) with
 * `parseDocumentationApiModel()` and shipped to the client as plain JSON by route
 * loaders.
 *
 * The specification's schema graph is deeply cyclic (e.g. `Content` →
 * `ContentBlockElement` → `ContentQuoteBlockElement` → `Content`), so schema nodes
 * reference each other by `$ref` name only and are resolved one level at a time at
 * render with `resolveDocumentationApiSchemaNode()`. Never eagerly resolve the
 * whole graph, it does not terminate.
 */

import {documentationApiHomeUrl} from "~/shared/docs/documentation_api_home_url.js";

export type DocumentationApiMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

/**
 * A JSON Schema node from the OpenAPI specification, narrowed to the fields we
 * render. Node trees are finite because cycles only exist through `$ref` names.
 */
export type DocumentationApiSchemaNode = {
    $ref?: string;
    type?: string | Array<string>;
    description?: string;
    properties?: Record<string, DocumentationApiSchemaNode>;
    required?: Array<string>;
    additionalProperties?: boolean | DocumentationApiSchemaNode;
    items?: DocumentationApiSchemaNode;
    oneOf?: Array<DocumentationApiSchemaNode>;
    allOf?: Array<DocumentationApiSchemaNode>;
    discriminator?: {propertyName: string; mapping?: Record<string, string>};
    enum?: Array<string | number | boolean | null>;
    const?: string | number | boolean | null;
    format?: string;
    pattern?: string;
    minLength?: number;
    maxLength?: number;
    minimum?: number;
    maximum?: number;
    minItems?: number;
    maxItems?: number;
    default?: unknown;
};

export type DocumentationApiParameter = {
    name: string;
    required: boolean;
    description: string | null;
    schema: DocumentationApiSchemaNode | null;
};

export type DocumentationApiRequestBody = {
    required: boolean;
    description: string | null;
    schema: DocumentationApiSchemaNode | null;
};

export type DocumentationApiResponse = {
    status: string;
    schema: DocumentationApiSchemaNode | null;
};

export type DocumentationApiOperation = {
    slug: string;
    method: DocumentationApiMethod;
    path: string;
    group: string;
    title: string;
    /**
     * The operation's OpenAPI `description` (or `summary`), if the spec has one.
     */
    description: string | null;
    pathParameters: Array<DocumentationApiParameter>;
    queryParameters: Array<DocumentationApiParameter>;
    requestBody: DocumentationApiRequestBody | null;
    response: DocumentationApiResponse | null;
};

/**
 * A lightweight reference to an operation for navigation and backlinks.
 */
export type DocumentationApiOperationReference = {
    slug: string;
    method: DocumentationApiMethod;
    path: string;
    title: string;
    description: string | null;
};

export type DocumentationApiBacklink =
    | {type: "schema"; name: string}
    | {type: "operation"; operation: DocumentationApiOperationReference}
    | {type: "webhook"};

export type DocumentationApiGroup = {
    name: string;
    title: string;
    operations: Array<DocumentationApiOperationReference>;
};

export type DocumentationApiModel = {
    title: string;
    description: string;
    version: string;
    serverUrl: string;
    groups: Array<DocumentationApiGroup>;
    operationsBySlug: Record<string, DocumentationApiOperation>;
    schemas: Record<string, DocumentationApiSchemaNode>;
    schemaNames: Array<string>;
    backlinksBySchemaName: Record<string, Array<DocumentationApiBacklink>>;
    webhookPayloadSchema: DocumentationApiSchemaNode | null;
    errorSchema: DocumentationApiSchemaNode | null;
};

/**
 * The schema name a `$ref` points at (e.g. `#/components/schemas/Content` →
 * `Content`).
 */
export function getDocumentationApiSchemaRefName(ref: string): string {
    return ref.split("/").pop() ?? ref;
}

/**
 * `_Request`/`_Response` suffixed schemas are specializations of a base type. We
 * display the base name with a small "request"/"response" pill while keeping
 * anchors on the full name.
 */
export function getDocumentationApiSchemaBaseName(name: string): string {
    return name.replace(/_(Response|Request)$/, "");
}

export type DocumentationApiSchemaNameVariant = "request" | "response" | null;

export function getDocumentationApiSchemaNameVariant(
    name: string,
): DocumentationApiSchemaNameVariant {
    if (name.endsWith("_Request")) return "request";
    if (name.endsWith("_Response")) return "response";
    return null;
}

/**
 * The URL slug for an operation. Since the slug embeds the operation path it
 * contains `/` characters, so routes match it with a splat (e.g.
 * `GET /documents/{id}` → `get/documents/id`).
 */
export function createDocumentationApiOperationSlug(
    method: DocumentationApiMethod,
    path: string,
): string {
    return `${method.toLowerCase()}${path.replaceAll(/[{}]/g, "")}`;
}

export function createDocumentationApiOperationUrl(slug: string): string {
    return `${documentationApiHomeUrl}/${slug}`;
}

export function createDocumentationApiSchemaUrl(name: string): string {
    return `${documentationApiHomeUrl}/schemas/${name}`;
}

/**
 * Resolve a schema node one level. If the node is a `$ref` to a named schema
 * return that schema's definition, otherwise return the node itself. This is
 * intentionally a single step: resolving the cyclic schema graph any deeper must
 * only happen through user interaction (expanding a doc row, hovering a type link,
 * navigating to a schema page).
 */
export function resolveDocumentationApiSchemaNode(
    schemas: Record<string, DocumentationApiSchemaNode>,
    node: DocumentationApiSchemaNode,
): {node: DocumentationApiSchemaNode; refName: string | null} {
    if (node.$ref === undefined) return {node, refName: null};

    const refName = getDocumentationApiSchemaRefName(node.$ref);
    const resolved = schemas[refName];
    if (resolved === undefined) return {node, refName};

    return {node: resolved, refName};
}
