import {ApiClientMock} from "~/server/agents/api/test_helpers/api_client_mock.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {callAgentWebReadTool} from "~/server/agents/web/call_agent_web_read_tool.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/create_agent_web_page_stored_link_pathname.js";
import {createAgentWebSessionStorageForTest} from "~/server/agents/web/test_helpers/create_agent_web_session_storage_for_test.js";
import {parseApiContentFromMarkdown} from "~/shared/api/content/parse_api_content_from_markdown.js";
import {ApiContentResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {defaultTimeZone} from "~/shared/helpers/intl/time_zone.js";
import {markdown} from "~/shared/helpers/string/markdown.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId, BotId, DocumentId, SpaceId} from "~/shared/id/types/id_types.js";
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

    await createAgentWebPageStoredLinkPathname(context.storage, {
        type: "Document",
        id: documentId,
        title: "Hello, world!",
    });

    api.mockGetDocument(spaceId, documentId, {
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
