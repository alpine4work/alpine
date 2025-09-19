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

- This bot is running in Alpine, an all-in-one productivity suite including documents, tasks, chat, forum, and more, where all products are deeply integrated for a cohesive experience.
- Alpine users are members of “spaces” (also known as “workspaces”). Typically, companies have one space containing all emplo`);
});
