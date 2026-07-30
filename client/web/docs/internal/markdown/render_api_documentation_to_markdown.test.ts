// The `render*` helpers here return markdown strings, not React Testing Library
// render results.
/* eslint-disable testing-library/render-result-naming-convention */
import {
    DocumentationApiModel,
    DocumentationApiOperation,
} from "~/client/web/docs/documentation_api_model.js";
import {
    renderApiOperationToMarkdown,
    renderDocumentationApiSchemaToMarkdown,
} from "~/client/web/docs/internal/markdown/render_api_documentation_to_markdown.js";

const model: DocumentationApiModel = {
    title: "Alpine API",
    description: "",
    version: "1",
    serverUrl: "https://api.example.com",
    groups: [],
    operationsBySlug: {},
    schemas: {
        SpaceId: {type: "string", pattern: "^[0-9abcdefghjkmnpqrstvwxyz]{26}$"},
        Task: {
            type: "object",
            required: ["id"],
            properties: {
                id: {$ref: "#/components/schemas/SpaceId"},
                title: {type: "string", description: "The task title.", maxLength: 512},
            },
        },
        TaskList: {
            type: "object",
            properties: {
                task: {$ref: "#/components/schemas/Task"},
            },
        },
        TaskEvent: {
            oneOf: [
                {$ref: "#/components/schemas/Task"},
                {$ref: "#/components/schemas/TaskList"},
                {type: "null"},
            ],
        },
    },
    schemaNames: ["SpaceId", "Task", "TaskEvent", "TaskList"],
    backlinksBySchemaName: {
        Task: [
            {
                type: "schema",
                name: "TaskList",
            },
            {
                type: "operation",
                operation: {
                    slug: "get/tasks/taskId",
                    method: "GET",
                    path: "/tasks/{taskId}",
                    title: "Get task",
                    description: null,
                },
            },
        ],
    },
    webhookPayloadSchema: null,
    errorSchema: null,
};

test("renders an endpoint with its method, path, and request fields", () => {
    const operation: DocumentationApiOperation = {
        slug: "post/tasks",
        method: "POST",
        path: "/tasks",
        group: "Tasks",
        title: "Create task",
        description: null,
        pathParameters: [],
        queryParameters: [],
        requestBody: {
            required: true,
            description: null,
            schema: {
                type: "object",
                required: ["spaceId"],
                properties: {spaceId: {$ref: "#/components/schemas/SpaceId"}},
            },
        },
        response: null,
    };

    const markdown = renderApiOperationToMarkdown(model, operation, {
        curl: "curl https://api.example.com/tasks",
        node: "await fetch()",
        response: null,
    });

    expect(markdown).toBe(
        [
            "# Create task",
            "",
            "`POST /tasks`",
            "",
            "## Request",
            "",
            "### Request body",
            "",
            "- `spaceId` [SpaceId](/docs/api/schemas/SpaceId.md) (required) [26-char base32 id]",
            "",
            "### Request example",
            "",
            "```bash",
            "curl https://api.example.com/tasks",
            "```",
            "",
            "```js",
            "await fetch()",
            "```",
            "",
            "",
        ].join("\n"),
    );
});

test("renders response body and example under response", () => {
    const responseValue = {
        id: "01J00000000000000000000000",
        title: "Launch checklist",
    };
    const responseJson = JSON.stringify(responseValue, null, 2);
    const operation: DocumentationApiOperation = {
        slug: "get/tasks/taskId",
        method: "GET",
        path: "/tasks/{taskId}",
        group: "Tasks",
        title: "Get task",
        description: null,
        pathParameters: [
            {
                name: "taskId",
                description: "The task to fetch.",
                required: true,
                schema: {$ref: "#/components/schemas/SpaceId"},
            },
        ],
        queryParameters: [],
        requestBody: null,
        response: {
            status: "200",
            schema: {$ref: "#/components/schemas/Task"},
        },
    };

    const markdown = renderApiOperationToMarkdown(model, operation, {
        curl: "curl https://api.example.com/tasks/01J00000000000000000000000",
        node: "await fetch()",
        response: {
            lines: responseJson.split("\n").map(text => ({text, hintId: null})),
            hints: [],
        },
    });

    expect(markdown).toBe(
        [
            "# Get task",
            "",
            "`GET /tasks/{taskId}`",
            "",
            "## Request",
            "",
            "### Path parameters",
            "",
            "- `taskId` [SpaceId](/docs/api/schemas/SpaceId.md) (required) [26-char base32 id]",
            "  The task to fetch.",
            "",
            "### Request example",
            "",
            "```bash",
            "curl https://api.example.com/tasks/01J00000000000000000000000",
            "```",
            "",
            "```js",
            "await fetch()",
            "```",
            "",
            "",
            "## Response",
            "",
            "### Response body",
            "",
            "- `id` [SpaceId](/docs/api/schemas/SpaceId.md) (required) [26-char base32 id]",
            "- `title` string (optional) [0–512 chars]",
            "  The task title.",
            "",
            "### Response example",
            "",
            "```json",
            responseJson,
            "```",
            "",
            "",
        ].join("\n"),
    );
});

test("renders a schema page linking named field types", () => {
    const jsonQuote = String.fromCodePoint(34);
    const markdown = renderDocumentationApiSchemaToMarkdown(model, "Task");
    expect(markdown).toBe(
        [
            "# `Task`",
            "",
            "`object`",
            "",
            "## Properties",
            "",
            "- `id` [SpaceId](/docs/api/schemas/SpaceId.md) (required) [26-char base32 id]",
            "- `title` string (optional) [0–512 chars]",
            "  The task title.",
            "",
            "## Example",
            "",
            "```json",
            "{",
            `  ${jsonQuote}id${jsonQuote}: ${jsonQuote}2k7pqz3m8rwvd1ac6yn0xhs4tb${jsonQuote},`,
            `  ${jsonQuote}title${jsonQuote}: ${jsonQuote}Q3 Planning${jsonQuote}`,
            "}",
            "```",
            "",
            "",
            "## Referenced by",
            "",
            "### Endpoints",
            "",
            "- [`GET /tasks/{taskId}`](/docs/api/get/tasks/taskId.md)",
            "",
            "### Schemas",
            "",
            "- [TaskList](/docs/api/schemas/TaskList.md)",
            "",
        ].join("\n"),
    );
});

test("renders a union schema page with linked variants and no example", () => {
    const markdown = renderDocumentationApiSchemaToMarkdown(model, "TaskEvent");
    expect(markdown).toBe(
        [
            "# `TaskEvent`",
            "",
            "`union · 3 variants`",
            "",
            "## Variants",
            "",
            "- [Task](/docs/api/schemas/Task.md)",
            "- [TaskList](/docs/api/schemas/TaskList.md)",
            "",
        ].join("\n"),
    );
});
