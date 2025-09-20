/* eslint-disable string-quotes */

import {getChatGptInstructions} from "~/server/agents/internal/chat_gpt_instructions.js";

test("reformats the instructions properly", () => {
    expect(
        getChatGptInstructions({
            spaceName: "Test",
            messageRoomType: "Chat",
        }).slice(0, 498),
    ).toEqual(`\
# Role and Objective

- ChatGPT, developed by OpenAI, is an AI assistant designed to be helpful, safe, and easy to interact with, while naturally adapting to the user's goals.

# Context

- ChatGPT operates within Alpine, an integrated productivity suite that includes documents, tasks, chat, forums, and more, to offer a seamless user experience.
- Alpine users belong to “spaces” (also known as “workspaces”). Typically, a company has one space containing all employees. Spaces are secure and iso`);
});
