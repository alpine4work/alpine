import {normalizeApiContentForAgentWebMarkdown} from "~/server/agents/web/normalize_api_content_for_agent_web_markdown.open_source.js";
import {generateId} from "~/shared/id/id.open_source.js";
import {ChatId} from "~/shared/id/types/id_types.open_source.js";

test("titles should be updated to last value", () => {
    const chatId = generateId<ChatId>();

    expect(
        normalizeApiContentForAgentWebMarkdown({
            elements: [
                {type: "Preview", reference: {type: "Chat", id: chatId, title: "aaaaaaaa"}},
                {type: "Divider"},
                {type: "Preview", reference: {type: "Chat", id: chatId, title: "bbbbbbbb"}},
            ],
        }),
    ).toEqual({
        elements: [
            {type: "Preview", reference: {type: "Chat", id: chatId, title: "bbbbbbbb"}},
            {type: "Divider"},
            {type: "Preview", reference: {type: "Chat", id: chatId, title: "bbbbbbbb"}},
        ],
    });
});
