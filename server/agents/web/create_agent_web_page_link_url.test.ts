import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.open_source.js";
import {createAgentWebPageLinkApiMentionReferenceIfPossible} from "~/server/agents/web/create_agent_web_page_link_api_mention_reference_if_possible.open_source.js";
import {createAgentWebPageLinkUrl} from "~/server/agents/web/create_agent_web_page_link_url.open_source.js";
import {cast} from "~/shared/helpers/control/cast.open_source.js";
import {ChatId, SpaceId} from "~/shared/id/types/id_types.open_source.js";

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
