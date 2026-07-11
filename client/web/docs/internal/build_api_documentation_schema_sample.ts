import {
    DocumentationApiModel,
    DocumentationApiSchemaNode,
} from "~/client/web/docs/documentation_api_model.js";
import {
    DocumentationApiResponseSample,
    buildDocumentationApiResponseSample,
} from "~/client/web/docs/internal/build_api_documentation_response_sample.js";
import {generateDocumentationApiSampleValue} from "~/client/web/docs/internal/generate_api_documentation_sample_value.js";

/**
 * Build the JSON example shown on schema pages. It reuses the response example
 * formatter so schema examples get the same field hints and JSON shape.
 */
export function buildDocumentationApiSchemaSample(
    model: DocumentationApiModel,
    schema: DocumentationApiSchemaNode,
): DocumentationApiResponseSample | null {
    if (schema.oneOf !== undefined) return null;

    const value = generateDocumentationApiSampleValue(model.schemas, schema);
    return value === null
        ? null
        : buildDocumentationApiResponseSample(model.schemas, schema, value);
}
