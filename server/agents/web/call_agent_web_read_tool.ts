import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

export async function callAgentWebReadTool(storage: AgentWebSessionStorage, path: string) {
    // Add a leading slash in case the LLM forgot to add one.
    if (!path.startsWith("/")) path = `/${path}`;

    // Remove the hash part of the URL before resolving. Just like in an actual web
    // server! The hash part is only visible to the client, it's not visible to the
    // server. So it doesn't change server resolution.
    //
    // As of 2026-03-28, we only use the hash part in agent web markdown for short
    // account mentions when the short name and long name are the same. For example,
    // `[ChatGPT](/bot/chatgpt#short)`. Since the short name for "ChatGPT" is
    // "ChatGPT".
    path = path.replace(/#.*$/, "");

    const pageLink = await storage.pageLinkByPath.get(path);

    if (!pageLink) {
        throw new NotFoundError("Link not found", {
            displayMessage: errorDisplayMessage`Nothing found for path \`${path}\`. You may only read paths you\u2019ve already seen a link for. Please try calling the \`read\` tool again with a path you\u2019ve seen before. If you\u2019re trying to read something you don\u2019t have a link for then don\u2019t try making up a path. Instead try calling the \`search\` tool which will help you find what you need and will give you links which you can use with the \`read\` tool.`,
        });
    }

    // NOCOMMIT: Implement
}
