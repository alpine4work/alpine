import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {mockApiGetDocument} from "~/server/agents/api/test_helpers/mock_api_get_document.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.open_source.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {storeAgentWebPageLinkForTest} from "~/server/agents/web/test_helpers/store_agent_web_page_link_for_test.js";
import {parseApiContentFromMarkdown} from "~/shared/api/content/parse_api_content_from_markdown.open_source.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {AccountId, BotId, DocumentId, SpaceId} from "~/shared/id/types/id_types.open_source.js";
import {testTracer} from "~/shared/tracer/dev/test_tracer.js";

const {span} = testTracer.startSpan("call_agent_web_read_tool_document.test.ts");
const api = new ApiClientMock();
const spaceId = generateId<SpaceId>();
const storage = createAgentWebSessionStorageForTest(spaceId);

const botAccountId = generateId<AccountId>();
const botId = generateId<BotId>();

const context: AgentWebContext = {
    spaceId,
    api,
    storage,
    span,
    timeZone: defaultTimeZone,
    botAccount: {
        type: "Account",
        id: botAccountId,
        title: "ChatGPT",
        shortName: "ChatGPT",
        bot: {id: botId},
        pathname: "/bot/chatgpt",
    },
};

test("reads document", async () => {
    const documentId = generateId<DocumentId>();

    await storeAgentWebPageLinkForTest(context.storage, {
        type: "Document",
        id: documentId,
        title: "Hello, world!",
    });

    mockApiGetDocument(api, {
        spaceId,
        documentId,
        version: 1,
        title: "Hello, world!",
        content: parseApiContentFromMarkdown(markdown`
This is a _really cool_ document!

- Item 1

- Item 2

- Item 3
        `) as ApiContentResponse,
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/document/hello-world",
            limit: "10kb",
        }),
    ).toEqual(`\
# Hello, world!

This is a _really cool_ document!

- Item 1

- Item 2

- Item 3`);
});

test("reads document with emphasis + strong formatting", async () => {
    const documentId = generateId<DocumentId>();

    await storeAgentWebPageLinkForTest(context.storage, {
        type: "Document",
        id: documentId,
        title: "Hello, world!",
    });

    mockApiGetDocument(api, {
        spaceId,
        documentId,
        version: 1,
        title: "Hello, world!",
        content: parseApiContentFromMarkdown(markdown`
This is a **_really cool_** document!

- Item 1

- Item 2

- Item 3
        `) as ApiContentResponse,
    });

    expect(
        await callAgentWebReadTool(context, {
            path: "/document/hello-world",
            limit: "10kb",
        }),
    ).toEqual(`\
# Hello, world!

This is a **_really cool_** document!

- Item 1

- Item 2

- Item 3`);
});
