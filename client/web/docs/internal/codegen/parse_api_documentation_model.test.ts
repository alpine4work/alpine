/* eslint-disable cyberworlds/string-quotes --
 * Straight quotes here are OpenAPI YAML fixture text, not UI copy. */
import {parseDocumentationApiModel} from "~/client/web/docs/internal/codegen/parse_api_documentation_model.js";

// A miniature specification exercising the parts of the real one that matter:
// grouping, title derivation, shared response/request body components, a
// discriminated union, and a `$ref` cycle (`Content` → `ContentQuoteElement` →
// `Content`).
const specificationYaml = `
openapi: 3.0.0
info:
    title: Alpine API
    description: The Alpine REST API.
    version: 1.0.0
servers:
    - url: https://api.alpine.inc
paths:
    /specification.yaml:
        get:
            responses:
                "200":
                    content:
                        application/yaml: {}
    /documents/{id}:
        parameters:
            - name: id
              in: path
              required: true
              schema:
                  $ref: "#/components/schemas/DocumentId"
        get:
            description: Fetch a document and its rich text content.
            responses:
                "200":
                    $ref: "#/components/responses/GetDocument"
                default:
                    $ref: "#/components/responses/Error"
    /documents:
        post:
            requestBody:
                required: true
                description: Create a document.
                content:
                    application/json:
                        schema:
                            type: object
                            required:
                                - content
                            properties:
                                content:
                                    $ref: "#/components/schemas/Content"
            responses:
                "201":
                    content:
                        application/json:
                            schema:
                                type: object
                                properties:
                                    id:
                                        $ref: "#/components/schemas/DocumentId"
    /chats/{id}/messages:
        get:
            parameters:
                - name: id
                  in: path
                  required: true
                  schema:
                      $ref: "#/components/schemas/DocumentId"
                - name: cursor
                  in: query
                  schema:
                      type: string
            responses:
                "200":
                    content:
                        application/json:
                            schema:
                                type: object
webhooks:
    bot:
        post:
            requestBody:
                content:
                    application/json:
                        schema:
                            type: object
                            properties:
                                event:
                                    $ref: "#/components/schemas/BotWebhookEvent"
components:
    responses:
        GetDocument:
            content:
                application/json:
                    schema:
                        type: object
                        properties:
                            content:
                                $ref: "#/components/schemas/Content"
        Error:
            content:
                application/json:
                    schema:
                        $ref: "#/components/schemas/Error"
    schemas:
        DocumentId:
            type: string
            pattern: "^[0-9abcdefghjkmnpqrstvwxyz]{25}[0-9abcdefghjkmnpqrstvw]$"
        Content:
            type: object
            description: Rich text content.
            required:
                - elements
            properties:
                elements:
                    type: array
                    items:
                        $ref: "#/components/schemas/ContentElement"
        ContentElement:
            oneOf:
                - $ref: "#/components/schemas/ContentTextElement"
                - $ref: "#/components/schemas/ContentQuoteElement"
            discriminator:
                propertyName: type
                mapping:
                    Text: "#/components/schemas/ContentTextElement"
                    Quote: "#/components/schemas/ContentQuoteElement"
        ContentTextElement:
            type: object
            properties:
                type:
                    const: Text
                text:
                    type: string
        ContentQuoteElement:
            type: object
            properties:
                type:
                    const: Quote
                content:
                    $ref: "#/components/schemas/Content"
        BotWebhookEvent:
            type: object
        Error:
            type: object
`;

test("skips the specification download endpoint", () => {
    const model = parseDocumentationApiModel(specificationYaml);
    expect(Object.keys(model.operationsBySlug)).not.toContain("get/specification.yaml");
});

test("groups operations by first path segment with title-cased names", () => {
    const model = parseDocumentationApiModel(specificationYaml);
    expect(model.groups.map(group => group.title)).toEqual(["Chats", "Documents"]);
});

test("derives readable operation titles", () => {
    const model = parseDocumentationApiModel(specificationYaml);
    expect({
        get: model.operationsBySlug["get/documents/id"]?.title,
        create: model.operationsBySlug["post/documents"]?.title,
        list: model.operationsBySlug["get/chats/id/messages"]?.title,
    }).toEqual({get: "Get document", create: "Create document", list: "List messages"});
});

test("includes operation descriptions in navigation references", () => {
    const model = parseDocumentationApiModel(specificationYaml);
    expect(model.groups.find(group => group.name === "documents")?.operations).toEqual(
        expect.arrayContaining([
            expect.objectContaining({
                slug: "get/documents/id",
                description: "Fetch a document and its rich text content.",
            }),
        ]),
    );
});

test("resolves shared response components to their JSON schema", () => {
    const model = parseDocumentationApiModel(specificationYaml);
    expect(
        model.operationsBySlug["get/documents/id"]?.response?.schema?.properties?.content,
    ).toEqual({$ref: "#/components/schemas/Content"});
});

test("splits path and query parameters", () => {
    const model = parseDocumentationApiModel(specificationYaml);
    expect(model.operationsBySlug["get/chats/id/messages"]).toMatchObject({
        pathParameters: [expect.objectContaining({name: "id", required: true})],
        queryParameters: [expect.objectContaining({name: "cursor", required: false})],
    });
});

test("parses discriminated unions", () => {
    const model = parseDocumentationApiModel(specificationYaml);
    expect(model.schemas.ContentElement).toMatchObject({
        oneOf: [
            {$ref: "#/components/schemas/ContentTextElement"},
            {$ref: "#/components/schemas/ContentQuoteElement"},
        ],
        discriminator: {propertyName: "type"},
    });
});

test("keeps cyclic schemas as unresolved refs", () => {
    const model = parseDocumentationApiModel(specificationYaml);
    expect(model.schemas.ContentQuoteElement?.properties?.content).toEqual({
        $ref: "#/components/schemas/Content",
    });
});

test("computes schema backlinks from other schemas", () => {
    const model = parseDocumentationApiModel(specificationYaml);
    expect(model.backlinksBySchemaName.Content).toEqual(
        expect.arrayContaining([
            {type: "schema", name: "ContentQuoteElement"},
            {
                type: "operation",
                operation: expect.objectContaining({slug: "post/documents"}),
            },
            {
                type: "operation",
                operation: expect.objectContaining({slug: "get/documents/id"}),
            },
        ]),
    );
});

test("computes webhook backlinks", () => {
    const model = parseDocumentationApiModel(specificationYaml);
    expect(model.backlinksBySchemaName.BotWebhookEvent).toEqual([{type: "webhook"}]);
});

test("parses the webhook payload schema", () => {
    const model = parseDocumentationApiModel(specificationYaml);
    expect(model.webhookPayloadSchema?.properties?.event).toEqual({
        $ref: "#/components/schemas/BotWebhookEvent",
    });
});

test("sorts schema names alphabetically", () => {
    const model = parseDocumentationApiModel(specificationYaml);
    expect(model.schemaNames).toEqual([
        "BotWebhookEvent",
        "Content",
        "ContentElement",
        "ContentQuoteElement",
        "ContentTextElement",
        "DocumentId",
        "Error",
    ]);
});
