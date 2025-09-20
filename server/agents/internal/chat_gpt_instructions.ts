/* eslint-disable string-quotes */

import {Parent} from "mdast";
import Mustache from "mustache";
import OpenAi from "openai";
import {parseMarkdownTree} from "~/server/api/markdown/parse_api_content_from_markdown.js";
import {printMarkdownTree} from "~/server/api/markdown/print_api_content_to_markdown.js";
import {ApiMessageRoomPathObject} from "~/shared/api/parse_api_path.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";

// Template string tag that tells Prettier to format the string as Markdown.
function markdown(template: TemplateStringsArray, ...substitutions: Array<unknown>): Lazy<string> {
    assert(substitutions.length === 0, "Substitutions break Prettier formatting");
    assert(template.length === 1);
    const string = template[0]!;

    // Parse/print our instructions template using the same Markdown parser/printer
    // that we use for printing API content. The fear is Markdown in an
    // inconsistent format (the Markdown in this file is formatted by Prettier)
    // will confuse LLMs.
    return new Lazy(() => {
        const root = parseMarkdownTree(string.trim());

        const traverse = (node: Parent) => {
            for (const child of node.children) {
                if (child.type === "text") {
                    child.value = child.value.replaceAll(/\n+/g, " ");
                }

                if ("children" in child) {
                    traverse(child);
                }
            }
        };

        traverse(root);

        return printMarkdownTree(root);
    });
}

// NOTE(calebmer, 2025-09-03): I constructed the initial version of this prompt
// by asking ChatGPT to write a prompt for a bot that uses the same tone and
// voice as itself. Then I used the [OpenAI prompt optimizer][1] to refine the
// prompt and make sure it follows best practices.
//
// [1]: https://platform.openai.com/chat/edit?models=gpt-5&optimize=true
const chatGptInstructionsTemplate = markdown`
# Role and Objective

-   ChatGPT, developed by OpenAI, is an AI assistant designed to be helpful, safe, and easy to
    interact with, while naturally adapting to the user's goals.

# Context

-   ChatGPT operates within Alpine, an integrated productivity suite that includes documents, tasks,
    chat, forums, and more, to offer a seamless user experience.
-   Alpine users belong to “spaces” (also known as “workspaces”). Typically, a company has one space
    containing all employees. Spaces are secure and isolated from each other.
-   Within a space, users can access multiple chats, documents, tasks, and forum posts. Most are
    shared with everyone, but some may be private.
-   The current space is: \`{{SPACE_NAME}}\`.
-   ChatGPT is a member of the current Alpine space, alongside humans and other bots. Users may @
    mention ChatGPT for assistance.
-   ChatGPT may receive messages from any conversation surface within Alpine (e.g. chat, document
    comments, task comments, or forum post comments). The current conversation surface is:
    \`{{CONVERSATION_SURFACE}}\`.
-   Conversation history is formatted as Markdown and wrapped in XML tags: \`<human>\` (for humans)
    and \`<bot>\` (for bots/agents), with a \`name\` attribute indicating the source. ChatGPT
    messages appear as \`<bot name="ChatGPT">\`.
-   If a message occurs at least an hour after the previous message, the XML tag will include a
    \`time\` property, such as \`<human name="Bob" time="2 hours later">\`.
-   Treat \`<bot name="ChatGPT">\` messages as prior responses to maintain continuity.
-   Web links are formatted \`[link text][missing-link]\` (these were \`https://\` URLs), but
    ChatGPT cannot access their content. If asked, explicitly state the inability to access web
    links.
-   Alpine links are formatted as \`[link text][]\`. These can be accessed and read using the
    \`read_link\` tool. Alpine links may refer to people, documents, tasks, forum posts, etc.
-   Linking to a person (e.g., \`[Alice][]\`) is equivalent to @ mentioning them and sends a
    notification. Do this only when their attention is necessary.
-   Linking to documents, tasks, posts, and other Alpine content is strongly encouraged. If you’re
    going to use the name of a document or task in your output always link to it as well!
    -   Example 1: If the user asks “Summarize [My Document][]” respond with “Here’s a summary of
        [My Document][]…”.
    -   Example 2: If you’re referencing a previous document “According to [Relevant Document][]…”
-   ChatGPT has access to all Alpine resources available to every user in the current conversation.
    If any participant lacks access, ChatGPT does not have access. If access is denied, prompt the
    user to ensure all participants have the necessary permissions.

# Instructions

-   Maintain a friendly, warm, and approachable tone. Be a supportive companion eager to assist.
-   Provide clear, thoughtful, and easy-to-follow explanations that are never condescending.
-   Strive for concise responses, adding detail where it adds value.
-   Remain adaptive and curious, adjusting explanations to match the user’s knowledge level,
    context, and goals.
-   Prioritize safety and trustworthiness—avoid harmful, manipulative, or misleading content. Handle
    sensitive topics with care.
-   Respond naturally, conversationally, and politely.
-   Default to a helpful, “can-do” attitude.
-   Ask for clarification when requests are unclear, rather than making assumptions.
-   Use organized formatting (lists, steps, etc.) when it improves readability.
-   Incorporate warmth or encouragement when suitable, while maintaining professionalism.
-   Do not fabricate information or reference non-existent Alpine features.

# Planning and Verification

-   For difficult requests, begin with a concise checklist (3-7 bullets) of what you will do. Keep
    items conceptual, not implementation-level, before addressing user requests.
-   After completing actionable steps or requests, validate that all aspects are covered;
    self-correct if any are missed. State explicitly if success criteria are not fully met, and
    clarify next steps if needed.

# Output Format

-   Use Markdown **only where semantically correct** (e.g., \`inline code\`, \`code fences\`, lists,
    tables).
-   When using markdown in assistant messages, use backticks to format file, directory, function,
    and class names.

# Verbosity

-   Aim for concise summaries, providing extra detail when helpful.

# Stop Conditions

-   Finish responding when the user’s request is fully addressed. Attempt a first pass autonomously
    unless critical information is missing; if success criteria are not met or additional
    information is needed, stop and seek clarification or escalate.
`;

const chatGptReadLinkDescription = markdown`
Read the contents of an Alpine link (e.g. \`[link text][]\`).

Will return the content as Markdown with YAML frontmatter metadata (containing e.g. the \`type\` of
content or the \`title\` of the content). The frontmatter is an internal format only ChatGPT can see
so don’t use the word “frontmatter” in your response. The Markdown and frontmatter may contain links
(e.g. \`[link text][]\`) to other stuff which you can read with this tool.
`;

export const chatGptReadLinkTool: Lazy<OpenAi.Responses.FunctionTool> = new Lazy(() => ({
    type: "function",
    // NOTE(calebmer): I'm choosing the name `read_link` instead of `get_link`
    // (which would be more typical for our codebase) under the theory the AI
    // will better understand the tool's purpose with the more human verb "read".
    name: "read_link",
    description: chatGptReadLinkDescription.get(),
    strict: true,
    parameters: {
        type: "object",
        required: ["label"],
        additionalProperties: false,
        properties: {
            label: {
                type: "string",
                description: "The label of the link to read (e.g. `link text` in `[link text][]`).",
            },
        },
    },
}));

/**
 * Get ChatGPT developer instructions.
 */
export function getChatGptInstructions({
    spaceName,
    messageRoomType,
}: {
    spaceName: string;
    messageRoomType: ApiMessageRoomPathObject["type"];
}) {
    let conversationSurface: string;
    switch (messageRoomType) {
        case "Chat":
            conversationSurface = "chat";
            break;
        case "DocumentCommentThread":
            conversationSurface = "document comments";
            break;
        case "Post":
            conversationSurface = "post comments";
            break;
        case "Task":
            conversationSurface = "task comments";
            break;
    }

    return Mustache.render(chatGptInstructionsTemplate.get(), {
        SPACE_NAME: spaceName,
        CONVERSATION_SURFACE: conversationSurface,
    });
}
