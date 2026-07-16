/* eslint-disable cyberworlds/string-quotes, no-template-curly-in-string --
 * Straight quotes here are OpenAPI YAML fixture text and expected code sample
 * output, not UI copy. */
import {buildDocumentationApiCodeSamples} from "~/client/web/docs/build_api_documentation_code_samples.js";
import {parseDocumentationApiModel} from "~/client/web/docs/internal/codegen/parse_api_documentation_model.js";

// The `Content` ↔ `ContentQuoteElement` cycle here is the important part: sample
// generation must depth-guard and terminate.
const specificationYaml = `
openapi: 3.0.0
info:
    title: Alpine API
    version: 1.0.0
servers:
    - url: https://api.alpine.inc
paths:
    /documents/{id}:
        parameters:
            - name: id
              in: path
              required: true
              schema:
                  $ref: "#/components/schemas/DocumentId"
        get:
            parameters:
                - name: sort
                  in: query
                  required: true
                  schema:
                      type: string
                      enum:
                          - updated since
                - name: cursor
                  in: query
                  schema:
                      type: string
                - name: limit
                  in: query
                  required: true
                  schema:
                      type: integer
            responses:
                "200":
                    content:
                        application/json:
                            schema:
                                type: object
                                required:
                                    - document
                                properties:
                                    document:
                                        $ref: "#/components/schemas/Document"
    /documents/{id}/comments/{index}:
        parameters:
            - name: id
              in: path
              required: true
              schema:
                  $ref: "#/components/schemas/DocumentId"
            - name: index
              in: path
              required: true
              schema:
                  type: integer
        delete:
            responses:
                "204":
                    description: Deleted
    /documents:
        post:
            requestBody:
                content:
                    application/json:
                        schema:
                            type: object
                            required:
                                - title
                                - content
                            properties:
                                title:
                                    type: string
                                content:
                                    $ref: "#/components/schemas/Content"
            responses:
                "201":
                    content:
                        application/json:
                            schema:
                                type: object
components:
    schemas:
        DocumentId:
            type: string
            pattern: "^[0-9abcdefghjkmnpqrstvwxyz]{25}[0-9abcdefghjkmnpqrstvw]$"
        Document:
            type: object
            required:
                - id
                - createdAt
            properties:
                id:
                    $ref: "#/components/schemas/DocumentId"
                createdAt:
                    type: string
                    format: date-time
        Content:
            type: object
            required:
                - elements
            properties:
                elements:
                    type: array
                    items:
                        $ref: "#/components/schemas/ContentElement"
        ContentElement:
            oneOf:
                - $ref: "#/components/schemas/ContentQuoteElement"
        ContentQuoteElement:
            type: object
            required:
                - type
                - content
            properties:
                type:
                    const: Quote
                content:
                    $ref: "#/components/schemas/Content"
`;

test("builds complete GET samples with path params, query params, and response hints", () => {
    const model = parseDocumentationApiModel(specificationYaml);
    const operation = model.operationsBySlug["get/documents/id"]!;
    expect(buildDocumentationApiCodeSamples(model, operation)).toEqual({
        curl:
            "curl https://api.alpine.inc/documents/9mxr4td0kwq2vc7ap5ynhs38xb" +
            "?sort=updated%20since&limit=value" +
            ' \\\n  -H "Authorization: Bearer $ALPINE_API_KEY"',
        node:
            'const res = await fetch("https://api.alpine.inc/documents/' +
            '9mxr4td0kwq2vc7ap5ynhs38xb?sort=updated%20since&limit=value", {\n' +
            '  method: "GET",\n' +
            '  headers: {\n    "Authorization": `Bearer ${process.env.ALPINE_API_KEY}`\n' +
            "  }\n" +
            "});\n" +
            "const data = await res.json();",
        response: {
            lines: [
                {text: "{", hintId: null},
                {text: '  "document": {', hintId: "document"},
                {text: '    "id": "9mxr4td0kwq2vc7ap5ynhs38xb",', hintId: "document.id"},
                {
                    text: '    "createdAt": "2026-01-15T09:30:00Z"',
                    hintId: "document.createdAt",
                },
                {text: "  }", hintId: null},
                {text: "}", hintId: null},
            ],
            hints: [
                {
                    id: "document",
                    path: "document",
                    name: "document",
                    required: true,
                    description: null,
                    node: {$ref: "#/components/schemas/Document"},
                },
                {
                    id: "document.id",
                    path: "document.id",
                    name: "id",
                    required: true,
                    description: null,
                    node: {$ref: "#/components/schemas/DocumentId"},
                },
                {
                    id: "document.createdAt",
                    path: "document.createdAt",
                    name: "createdAt",
                    required: true,
                    description: null,
                    node: {type: "string", format: "date-time"},
                },
            ],
        },
    });
});

test("builds complete POST samples with request body and response example", () => {
    const model = parseDocumentationApiModel(specificationYaml);
    const operation = model.operationsBySlug["post/documents"]!;
    expect(buildDocumentationApiCodeSamples(model, operation)).toEqual({
        curl:
            "curl https://api.alpine.inc/documents" +
            " \\\n  -X POST" +
            ' \\\n  -H "Authorization: Bearer $ALPINE_API_KEY"' +
            ' \\\n  -H "Content-Type: application/json"' +
            " \\\n  -d '{\n" +
            '  "title": "Q3 Planning",\n' +
            '  "content": {\n' +
            '    "elements": [\n' +
            "      {\n" +
            '        "type": "Quote",\n' +
            '        "content": {\n' +
            '          "elements": [\n' +
            "            {\n" +
            '              "type": "Quote",\n' +
            '              "content": {}\n' +
            "            }\n" +
            "          ]\n" +
            "        }\n" +
            "      }\n" +
            "    ]\n" +
            "  }\n" +
            "}'",
        node:
            'const res = await fetch("https://api.alpine.inc/documents", {\n' +
            '  method: "POST",\n' +
            '  headers: {\n    "Authorization": `Bearer ${process.env.ALPINE_API_KEY}`,\n' +
            '    "Content-Type": "application/json"\n' +
            "  },\n" +
            "  body: JSON.stringify({\n" +
            '    "title": "Q3 Planning",\n' +
            '    "content": {\n' +
            '      "elements": [\n' +
            "        {\n" +
            '          "type": "Quote",\n' +
            '          "content": {\n' +
            '            "elements": [\n' +
            "              {\n" +
            '                "type": "Quote",\n' +
            '                "content": {}\n' +
            "              }\n" +
            "            ]\n" +
            "          }\n" +
            "        }\n" +
            "      ]\n" +
            "    }\n" +
            "  })\n" +
            "});\n" +
            "const data = await res.json();",
        response: {
            lines: [{text: "{}", hintId: null}],
            hints: [],
        },
    });
});

test("builds complete DELETE samples without body or response example", () => {
    const model = parseDocumentationApiModel(specificationYaml);
    const operation = model.operationsBySlug["delete/documents/id/comments/index"]!;
    expect(buildDocumentationApiCodeSamples(model, operation)).toEqual({
        curl:
            "curl https://api.alpine.inc/documents/9mxr4td0kwq2vc7ap5ynhs38xb/comments/0" +
            " \\\n  -X DELETE" +
            ' \\\n  -H "Authorization: Bearer $ALPINE_API_KEY"',
        node:
            'const res = await fetch("https://api.alpine.inc/documents/' +
            '9mxr4td0kwq2vc7ap5ynhs38xb/comments/0", {\n' +
            '  method: "DELETE",\n' +
            '  headers: {\n    "Authorization": `Bearer ${process.env.ALPINE_API_KEY}`\n' +
            "  }\n" +
            "});\n" +
            "const data = await res.json();",
        response: null,
    });
});
