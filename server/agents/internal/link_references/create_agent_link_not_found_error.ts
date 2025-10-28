import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

export function createAgentLinkNotFoundError(path: string) {
    return new NotFoundError("Link not found", {
        displayMessage: errorDisplayMessage`Nothing found for link \`${path}\`. You may only read things you’ve already seen a link for. Please try calling the \`read_link\` tool again with a link you’ve seen before. If you’re trying to read something you don’t have a link for then don’t try making up a link. Instead try calling the \`search_alpine\` tool which will help you find what you need and will give you links which you can use with the \`read_link\` tool.`,
    });
}
