/* eslint-disable cyberworlds/string-quotes, no-template-curly-in-string --
 * Straight quotes and `${...}` markers in this module are generated code
 * sample text (shell and JavaScript syntax), not UI copy. */
import {
    DocumentationApiModel,
    DocumentationApiOperation,
} from "~/client/web/docs/documentation_api_model.js";
import {
    DocumentationApiResponseSample,
    buildDocumentationApiResponseSample,
} from "~/client/web/docs/internal/build_api_documentation_response_sample.js";
import {
    generateDocumentationApiSampleValue,
    getDocumentationApiExampleId,
} from "~/client/web/docs/internal/generate_api_documentation_sample_value.js";

export type DocumentationApiCodeSamples = {
    curl: string;
    node: string;
    response: DocumentationApiResponseSample | null;
};

/**
 * Build the request samples (cURL and Node fetch) and the JSON response example
 * for an operation's code sample panel. Generated entirely from the operation's
 * schemas so samples stay in lockstep with the specification.
 */
export function buildDocumentationApiCodeSamples(
    model: DocumentationApiModel,
    operation: DocumentationApiOperation,
): DocumentationApiCodeSamples {
    const url = `${model.serverUrl}${buildSamplePath(operation)}`;

    const bodyValue =
        operation.requestBody?.schema != null
            ? generateDocumentationApiSampleValue(model.schemas, operation.requestBody.schema)
            : null;
    const bodyJson = bodyValue !== null ? JSON.stringify(bodyValue, null, 2) : null;

    const responseSchema = operation.response?.schema ?? null;
    const responseValue =
        responseSchema !== null
            ? generateDocumentationApiSampleValue(model.schemas, responseSchema)
            : null;
    const response =
        responseSchema !== null && responseValue !== null
            ? buildDocumentationApiResponseSample(model.schemas, responseSchema, responseValue)
            : null;

    return {
        curl: buildCurlSample({method: operation.method, url, bodyJson}),
        node: buildNodeFetchSample({method: operation.method, url, bodyJson}),
        response,
    };
}

/**
 * Compatibility export for stale Vite route modules that imported the old API docs
 * builder name before the documentation API prefix rename.
 */
export const buildApiDocumentationCodeSamples = buildDocumentationApiCodeSamples;

function buildSamplePath(operation: DocumentationApiOperation): string {
    let path = operation.path;

    for (const parameter of operation.pathParameters) {
        const schema = parameter.schema;
        let value = "0";
        if (schema?.$ref !== undefined) {
            value = getDocumentationApiExampleId(schema.$ref.split("/").pop() ?? null);
        }
        path = path.replace(`{${parameter.name}}`, value);
    }

    const query = operation.queryParameters
        .filter(parameter => parameter.required)
        .map(parameter => {
            const enumValues = parameter.schema?.enum;
            const value =
                enumValues !== undefined && enumValues.length > 0 ? String(enumValues[0]) : "value";
            return `${parameter.name}=${encodeURIComponent(value)}`;
        });
    if (query.length > 0) path += `?${query.join("&")}`;

    return path;
}

function buildCurlSample({
    method,
    url,
    bodyJson,
}: {
    method: string;
    url: string;
    bodyJson: string | null;
}): string {
    let sample = `curl ${url}`;
    if (method !== "GET") sample += ` \\\n  -X ${method}`;
    sample += ' \\\n  -H "Authorization: Bearer $ALPINE_API_KEY"';
    if (bodyJson !== null) {
        sample += ' \\\n  -H "Content-Type: application/json"';
        sample += ` \\\n  -d '${bodyJson}'`;
    }
    return sample;
}

function buildNodeFetchSample({
    method,
    url,
    bodyJson,
}: {
    method: string;
    url: string;
    bodyJson: string | null;
}): string {
    let sample = `const res = await fetch("${url}", {\n`;
    sample += `  method: "${method}",\n`;
    sample += '  headers: {\n    "Authorization": `Bearer ${process.env.ALPINE_API_KEY}`';
    if (bodyJson !== null) sample += ',\n    "Content-Type": "application/json"';
    sample += "\n  }";
    if (bodyJson !== null) {
        const indentedBodyJson = bodyJson
            .split("\n")
            .map((line, index) => (index === 0 ? line : `  ${line}`))
            .join("\n");
        sample += `,\n  body: JSON.stringify(${indentedBodyJson})`;
    }
    sample += "\n});\nconst data = await res.json();";
    return sample;
}
