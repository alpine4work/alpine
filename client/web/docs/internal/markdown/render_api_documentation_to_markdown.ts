import {DocumentationApiCodeSamples} from "~/client/web/docs/build_api_documentation_code_samples.js";
import {createDocumentationApiPageUrl} from "~/client/web/docs/create_documentation_api_page_url.js";
import {
    DocumentationApiBacklink,
    DocumentationApiModel,
    DocumentationApiOperation,
    DocumentationApiParameter,
    DocumentationApiSchemaNode,
    createDocumentationApiOperationUrl,
    createDocumentationApiSchemaUrl,
    getDocumentationApiSchemaBaseName,
    getDocumentationApiSchemaRefName,
    resolveDocumentationApiSchemaNode,
} from "~/client/web/docs/documentation_api_model.js";
import {buildDocumentationApiSchemaSample} from "~/client/web/docs/internal/build_api_documentation_schema_sample.js";
import {toDocumentationMarkdownCodeBlock} from "~/client/web/docs/internal/documentation_code_block.js";
import {getDocumentationApiConstraintMeta} from "~/client/web/docs/internal/get_api_documentation_constraint_meta.js";
import {getDocumentationApiSchemaKindLabel} from "~/client/web/docs/internal/get_api_documentation_schema_kind_label.js";
import {toDocumentationMarkdownLinkUrl} from "~/client/web/docs/internal/to_documentation_markdown_link_url.js";

/**
 * Render one API endpoint page (title, params, schemas, and samples) to markdown.
 */
export function renderApiOperationToMarkdown(
    model: DocumentationApiModel,
    operation: DocumentationApiOperation,
    samples: DocumentationApiCodeSamples,
): string {
    const sections: Array<string> = [
        `# ${operation.title}\n`,
        `\`${operation.method} ${operation.path}\`\n`,
    ];
    if (operation.description !== null) sections.push(`${operation.description}\n`);

    const requestSections: Array<string> = [];
    if (operation.pathParameters.length > 0) {
        requestSections.push(
            `### Path parameters\n\n${renderParametersMarkdown(model, operation.pathParameters)}`,
        );
    }
    if (operation.queryParameters.length > 0) {
        requestSections.push(
            `### Query parameters\n\n${renderParametersMarkdown(model, operation.queryParameters)}`,
        );
    }
    if (operation.requestBody?.schema != null) {
        requestSections.push(
            `### Request body\n\n${renderSchemaMarkdown(model, operation.requestBody.schema)}`,
        );
    }

    requestSections.push(
        `### Request example\n\n${toDocumentationMarkdownCodeBlock(samples.curl, "bash")}${toDocumentationMarkdownCodeBlock(samples.node, "js")}`,
    );
    sections.push(`## Request\n\n${requestSections.join("\n")}`);

    const responseSections: Array<string> = [];
    if (operation.response?.schema != null) {
        responseSections.push(
            `### Response body\n\n${renderSchemaMarkdown(model, operation.response.schema)}`,
        );
    }
    if (samples.response !== null) {
        responseSections.push(
            `### Response example\n\n${toDocumentationMarkdownCodeBlock(samples.response.lines.map(line => line.text).join("\n"), "json")}`,
        );
    }
    if (responseSections.length > 0) sections.push(`## Response\n\n${responseSections.join("\n")}`);

    return sections.join("\n");
}

/**
 * Render a single schema node's fields to markdown. Used by API MDX pages to
 * inline a schema (the Error envelope, the webhook payload) into their `.md`.
 */
export function renderDocumentationApiSchemaNodeToMarkdown(
    model: DocumentationApiModel,
    node: DocumentationApiSchemaNode | null,
): string {
    return renderSchemaMarkdown(model, node);
}

/** Render one API schema page (kind + fields) to markdown. */
export function renderDocumentationApiSchemaToMarkdown(
    model: DocumentationApiModel,
    name: string,
): string {
    const schema = model.schemas[name];
    if (schema === undefined) return `# ${name}\n\n_Unknown schema._\n`;
    const sample = buildDocumentationApiSchemaSample(model, schema);
    const backlinks = renderSchemaBacklinksMarkdown(model.backlinksBySchemaName[name] ?? []);
    const bodyHeading =
        schema.oneOf !== undefined
            ? "Variants"
            : schema.enum !== undefined
              ? "Values"
              : "Properties";
    const body =
        schema.oneOf !== undefined
            ? renderSchemaVariantsMarkdown(model, schema)
            : renderSchemaMarkdown(model, schema);

    return [
        `# \`${name}\`\n`,
        `\`${getDocumentationApiSchemaKindLabel(schema)}\`\n`,
        ...(schema.description !== undefined ? [`${schema.description}\n`] : []),
        `## ${bodyHeading}\n\n${body}`,
        ...(sample !== null
            ? [
                  `## Example\n\n${toDocumentationMarkdownCodeBlock(sample.lines.map(line => line.text).join("\n"), "json")}`,
              ]
            : []),
        ...(backlinks.length > 0 ? [`## Referenced by\n\n${backlinks}`] : []),
    ].join("\n");
}

/**
 * Render a union schema as links to its non-null variant schemas.
 */
function renderSchemaVariantsMarkdown(
    model: DocumentationApiModel,
    schema: DocumentationApiSchemaNode,
): string {
    const variants = (schema.oneOf ?? []).filter(variant => variant.type !== "null");
    return `${variants
        .map(variant => `- ${documentationApiTypeLabelMarkdown(model, variant)}`)
        .join("\n")}\n`;
}

/**
 * Render the schema "Referenced by" section grouped by endpoints, schemas, and
 * webhooks.
 */
function renderSchemaBacklinksMarkdown(backlinks: ReadonlyArray<DocumentationApiBacklink>): string {
    const operationBacklinks = backlinks.filter(backlink => backlink.type === "operation");
    const schemaBacklinks = backlinks.filter(backlink => backlink.type === "schema");
    const webhookBacklinks = backlinks.filter(backlink => backlink.type === "webhook");
    const sections: Array<string> = [];

    if (operationBacklinks.length > 0) {
        sections.push(
            `### Endpoints\n\n${operationBacklinks
                .map(
                    backlink =>
                        `- [\`${backlink.operation.method} ${backlink.operation.path}\`](${toDocumentationMarkdownLinkUrl(createDocumentationApiOperationUrl(backlink.operation.slug))})`,
                )
                .join("\n")}\n`,
        );
    }

    if (schemaBacklinks.length > 0) {
        sections.push(
            `### Schemas\n\n${schemaBacklinks
                .map(
                    backlink =>
                        `- [${getDocumentationApiSchemaBaseName(backlink.name)}](${toDocumentationMarkdownLinkUrl(createDocumentationApiSchemaUrl(backlink.name))})`,
                )
                .join("\n")}\n`,
        );
    }

    if (webhookBacklinks.length > 0) {
        sections.push(
            `### Webhooks\n\n${webhookBacklinks
                .map(
                    () =>
                        `- [bot webhook](${toDocumentationMarkdownLinkUrl(createDocumentationApiPageUrl("webhooks"))})`,
                )
                .join("\n")}\n`,
        );
    }

    return sections.join("\n");
}

/**
 * Render path or query parameters as markdown bullets with type and constraint
 * metadata.
 */
function renderParametersMarkdown(
    model: DocumentationApiModel,
    parameters: ReadonlyArray<DocumentationApiParameter>,
): string {
    return `${parameters
        .map(parameter => {
            const type =
                parameter.schema !== null
                    ? documentationApiTypeLabelMarkdown(model, parameter.schema)
                    : "";
            const meta =
                parameter.schema !== null
                    ? getDocumentationApiConstraintMeta(model.schemas, parameter.schema)
                    : [];
            const header = `- \`${parameter.name}\`${type.length > 0 ? ` ${type}` : ""} (${
                parameter.required ? "required" : "optional"
            })${meta.length > 0 ? ` [${meta.join(", ")}]` : ""}`;
            return parameter.description !== null
                ? `${header}\n${indentMarkdown(parameter.description)}`
                : header;
        })
        .join("\n")}\n`;
}

/**
 * Render a schema node's fields. Named types (`$ref`) become links to their own
 * page (never inlined, which also breaks the cyclic schema graph); inline objects
 * and arrays of inline objects are expanded in place.
 */
function renderSchemaMarkdown(
    model: DocumentationApiModel,
    node: DocumentationApiSchemaNode | null,
    depth = 0,
): string {
    if (node === null) return "_None._\n";
    if (depth > 6) return "";

    const {node: resolved} = resolveDocumentationApiSchemaNode(model.schemas, node);

    if (resolved.oneOf !== undefined) {
        const variants = resolved.oneOf.filter(variant => variant.type !== "null");
        return `One of:\n\n${variants.map(variant => `- ${documentationApiTypeLabelMarkdown(model, variant)}`).join("\n")}\n`;
    }

    if (resolved.type === "array" || resolved.items !== undefined) {
        const items = resolved.items ?? null;
        return `Array of ${documentationApiTypeLabelMarkdown(model, items)}.\n\n${renderInlineChildMarkdown(model, items, depth)}`;
    }

    if (resolved.enum !== undefined) {
        return `One of: ${resolved.enum.map(value => `\`${JSON.stringify(value)}\``).join(", ")}\n`;
    }

    if (resolved.type === "object" || resolved.properties !== undefined) {
        const properties = resolved.properties ?? {};
        const requiredNames = resolved.required ?? [];
        if (Object.keys(properties).length === 0) {
            return resolved.additionalProperties === true
                ? "Free-form object.\n"
                : "Empty object.\n";
        }
        return `${Object.entries(properties)
            .map(([name, propertyNode]) =>
                renderPropertyMarkdown(
                    model,
                    name,
                    propertyNode,
                    requiredNames.includes(name),
                    depth,
                ),
            )
            .join("\n")}\n`;
    }

    const meta = getDocumentationApiConstraintMeta(model.schemas, resolved);
    return `${documentationApiTypeLabelMarkdown(model, resolved)}${meta.length > 0 ? ` [${meta.join(", ")}]` : ""}${
        resolved.description !== undefined ? `\n\n${resolved.description}` : ""
    }\n`;
}

/**
 * Render one object property row, including description and any inline nested
 * object fields.
 */
function renderPropertyMarkdown(
    model: DocumentationApiModel,
    name: string,
    node: DocumentationApiSchemaNode,
    required: boolean,
    depth: number,
): string {
    const meta = getDocumentationApiConstraintMeta(model.schemas, node);
    const header = `- \`${name}\` ${documentationApiTypeLabelMarkdown(model, node)} (${
        required ? "required" : "optional"
    })${meta.length > 0 ? ` [${meta.join(", ")}]` : ""}`;

    const lines = [header];
    if (node.description !== undefined) lines.push(indentMarkdown(node.description));
    const nested = renderInlineChildMarkdown(model, node, depth);
    if (nested.length > 0) lines.push(indentMarkdown(nested.trimEnd()));
    return lines.join("\n");
}

/**
 * Render inline object children for anonymous object schemas while leaving named
 * `$ref` schemas as links.
 */
function renderInlineChildMarkdown(
    model: DocumentationApiModel,
    node: DocumentationApiSchemaNode | null,
    depth: number,
): string {
    if (node === null || node.$ref !== undefined || depth > 6) return "";
    const isObject =
        (node.type === "object" || node.properties !== undefined) &&
        Object.keys(node.properties ?? {}).length > 0;
    const arrayItems =
        node.type === "array" || node.items !== undefined ? (node.items ?? null) : null;
    if (isObject) return renderSchemaMarkdown(model, node, depth + 1);
    if (
        arrayItems !== null &&
        arrayItems.$ref === undefined &&
        arrayItems.properties !== undefined
    ) {
        return renderSchemaMarkdown(model, arrayItems, depth + 1);
    }
    return "";
}

/**
 * Render the compact markdown type label used beside params and properties.
 */
function documentationApiTypeLabelMarkdown(
    model: DocumentationApiModel,
    node: DocumentationApiSchemaNode | null,
): string {
    if (node === null) return "any";
    if (node.$ref !== undefined) {
        const refName = getDocumentationApiSchemaRefName(node.$ref);
        return `[${getDocumentationApiSchemaBaseName(refName)}](${toDocumentationMarkdownLinkUrl(createDocumentationApiSchemaUrl(refName))})`;
    }
    if (node.type === "array" || node.items !== undefined) {
        return `array of ${documentationApiTypeLabelMarkdown(model, node.items ?? null)}`;
    }
    return getDocumentationApiSchemaKindLabel(node);
}

/**
 * Indent continuation lines under the current markdown list item.
 */
function indentMarkdown(text: string): string {
    return text
        .split("\n")
        .map(line => (line.length > 0 ? `  ${line}` : line))
        .join("\n");
}
