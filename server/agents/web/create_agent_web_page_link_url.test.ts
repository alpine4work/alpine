import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.open_source.js";
import {createAgentWebPageLinkApiMentionReferenceIfPossible} from "~/server/agents/web/create_agent_web_page_link_api_mention_reference_if_possible.open_source.js";
import {createAgentWebPageLinkUrl} from "~/server/agents/web/create_agent_web_page_link_url.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {ChatId, SpaceId, TaskId} from "~/shared/id/types/id_types.open_source.js";

test("will use the canonical URL for a chat message reference", () => {
    const pageLink = cast<Extract<AgentWebPageLink, {readonly type: "ChatMessage"}>>({
        type: "ChatMessage",
        id: "chat-1" as ChatId,
        index: 7,
        authorShortName: "Ada",
        preview: "Hello",
    });

    const result = createAgentWebPageLinkApiMentionReferenceIfPossible(
        pageLink,
        "space-1" as SpaceId,
    );

    expect(result).toEqual({type: "Url", url: createAgentWebPageLinkUrl(pageLink)});
    expect(result).toEqual({type: "Url", url: "https://alpine.inc/chat/chat-1?message=7"});
});

test("will point links at the environment we are running in", () => {
    const pageLink = cast<Extract<AgentWebPageLink, {readonly type: "TaskMessage"}>>({
        type: "TaskMessage",
        id: "task-1" as TaskId,
        index: 3,
        authorShortName: "Ada",
        preview: "Hello",
    });

    const previousAlpineUrl = process.env.ALPINE_URL;
    process.env.ALPINE_URL = "http://localhost:3000";

    try {
        expect(createAgentWebPageLinkUrl(pageLink)).toBe(
            "http://localhost:3000/task/task-1?comment=3",
        );
    } finally {
        if (previousAlpineUrl === undefined) {
            delete process.env.ALPINE_URL;
        } else {
            process.env.ALPINE_URL = previousAlpineUrl;
        }
    }
});
