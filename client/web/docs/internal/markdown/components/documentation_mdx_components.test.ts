// Straight quotes below are markdown syntax in expected-output assertions.
/* eslint-disable cyberworlds/string-quotes */
import {DocumentationApiModel} from "~/client/web/docs/documentation_api_model.js";
import {createDocumentationMdxMarkdownComponents} from "~/client/web/docs/internal/markdown/components/documentation_mdx_components.js";
import type {DocumentationMdxMarkdownComponentName} from "~/client/web/docs/internal/markdown/components/documentation_mdx_components.js";

const documentationApiModel: DocumentationApiModel = {
    title: "Alpine API",
    description: "",
    version: "1",
    serverUrl: "https://api.example.com",
    groups: [],
    operationsBySlug: {
        "get/tasks": {
            slug: "get/tasks",
            method: "GET",
            path: "/tasks",
            group: "Tasks",
            title: "List tasks",
            description: null,
            pathParameters: [],
            queryParameters: [],
            requestBody: null,
            response: null,
        },
    },
    schemas: {
        SpaceId: {type: "string", pattern: "^[0-9abcdefghjkmnpqrstvwxyz]{26}$"},
        Task: {
            type: "object",
            required: ["id"],
            properties: {
                id: {$ref: "#/components/schemas/SpaceId"},
                title: {type: "string"},
            },
        },
    },
    schemaNames: ["SpaceId", "Task"],
    backlinksBySchemaName: {},
    webhookPayloadSchema: null,
    errorSchema: null,
};

const md = createDocumentationMdxMarkdownComponents(documentationApiModel);

const card = md.Card!({title: "Tasks", url: "/docs/tasks", children: "Manage work."});
const emptyCard = md.Card!({title: "Chat", url: "/docs/chat"});
const headerRow = md.tr!({children: [md.th!({children: "Field"}), md.th!({children: "Value"})]});
const bodyRow = md.tr!({children: [md.td!({children: "Status"}), md.td!({children: "Open"})]});
const tableHead = md.thead!({children: headerRow});
const tableBody = md.tbody!({children: bodyRow});
const firstTab = md.Tab!({title: "Curl", children: "curl example"});
const secondTab = md.Tab!({title: "Node", children: "node example"});
const firstStep = md.Step!({title: "First", children: "Do a thing."});
const secondStep = md.Step!({title: "Second", children: "Do another."});

const outputs: Record<DocumentationMdxMarkdownComponentName, string> = {
    ApiStats: md.ApiStats!({}),
    BaseUrl: md.BaseUrl!({}),
    Callout: md.Callout!({type: "warning", title: "Careful", children: "Do not do this."}),
    Card: card,
    CardGrid: md.CardGrid!({children: [card, emptyCard]}),
    ExampleId: md.ExampleId!({type: "SpaceId"}),
    Frame: md.Frame!({label: "Inbox", caption: "The inbox."}),
    Kbd: md.Kbd!({children: "Cmd K"}),
    Schema: md.Schema!({name: "Task"}),
    Step: firstStep,
    Steps: md.Steps!({children: [firstStep, secondStep]}),
    Tab: firstTab,
    Tabs: md.Tabs!({children: [firstTab, secondTab]}),
    TypeLink: md.TypeLink!({name: "Task"}),
    a: md.a!({href: "/docs/x", children: "X"}),
    blockquote: md.blockquote!({children: "Quoted\n\nAgain"}),
    br: md.br!({}),
    code: md.code!({children: "npm test"}),
    del: md.del!({children: "gone"}),
    em: md.em!({children: "important"}),
    h1: md.h1!({children: "Overview"}),
    h2: md.h2!({children: "Anatomy"}),
    h3: md.h3!({children: "Details"}),
    hr: md.hr!({}),
    img: md.img!({alt: "Screenshot", src: "/docs/screenshot.png"}),
    input: md.input!({checked: true}),
    li: md.li!({children: "item"}),
    ol: md.ol!({
        children: [
            md.li!({children: "first"}),
            md.li!({children: "second"}),
            md.li!({children: "third"}),
        ],
    }),
    p: md.p!({children: "Hello world."}),
    pre: md.pre!({children: md.code!({className: "language-json", children: '{"a": 1}'})}),
    strong: md.strong!({children: "bold"}),
    table: md.table!({children: [tableHead, tableBody]}),
    tbody: tableBody,
    td: md.td!({children: "Open"}),
    th: md.th!({children: "Field"}),
    thead: tableHead,
    tr: bodyRow,
    ul: md.ul!({
        children: [
            md.li!({children: "first"}),
            md.li!({children: "second"}),
            md.li!({children: "third"}),
        ],
    }),
};

test("covers every static documentation markdown renderer", () => {
    expect(Object.keys(md).sort()).toEqual(Object.keys(outputs).sort());
});

test("renders static documentation markdown component output", () => {
    expect(outputs).toEqual({
        ApiStats:
            "- Base URL: `https://api.example.com`\n- Format: JSON over HTTPS\n- Endpoints: 1\n- Named types: 2\n\n",
        BaseUrl: "```\nhttps://api.example.com\n```\n\n",
        Callout: "> [!WARNING]\n> **Careful**\n> Do not do this.\n\n",
        Card: "- [Tasks](/docs/tasks.md): Manage work.",
        CardGrid: "- [Tasks](/docs/tasks.md): Manage work.\n- [Chat](/docs/chat.md)\n\n",
        ExampleId: "`2k7pqz3m8rwvd1ac6yn0xhs4tb`",
        Frame: "> [Inbox]\n> The inbox.\n\n",
        Kbd: "`Cmd K`",
        Schema: "- `id` [SpaceId](/docs/api/schemas/SpaceId.md) (required) [26-char base32 id]\n- `title` string (optional)\n\n",
        Step: "**First**\n\nDo a thing.",
        Steps: "1. **First**\n\n   Do a thing.\n2. **Second**\n\n   Do another.\n\n",
        Tab: "#### Curl\n\ncurl example",
        Tabs: "#### Curl\n\ncurl example\n\n#### Node\n\nnode example\n\n",
        TypeLink: "[Task](/docs/api/schemas/Task.md)",
        a: "[X](/docs/x.md)",
        blockquote: "> Quoted\n>\n> Again\n\n",
        br: "  \n",
        code: "`npm test`",
        del: "~~gone~~",
        em: "*important*",
        h1: "# Overview\n\n",
        h2: "## Anatomy\n\n",
        h3: "### Details\n\n",
        hr: "---\n\n",
        img: "![Screenshot](/docs/screenshot.png)",
        input: "[x] ",
        li: "item",
        ol: "1. first\n2. second\n3. third\n\n",
        p: "Hello world.\n\n",
        pre: '```json\n{"a": 1}\n```\n\n',
        strong: "**bold**",
        table: "| Field | Value |\n| --- | --- |\n| Status | Open |\n\n",
        tbody: "| Status | Open |",
        td: "Open",
        th: "Field",
        thead: "| Field | Value |\n| --- | --- |",
        tr: "| Status | Open |",
        ul: "- first\n- second\n- third\n\n",
    });
});
