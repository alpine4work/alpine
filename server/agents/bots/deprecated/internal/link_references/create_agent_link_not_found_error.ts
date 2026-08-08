import {NotFoundError} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";

export function createAgentLinkNotFoundError(path: string) {
    return new NotFoundError("Link not found", {
        displayMessage: errorDisplayMessage`Nothing found for link \`${path}\`. You may only read things you\u2019ve already seen a link for. Please try calling the \`read_link\` tool again with a link you\u2019ve seen before. If you\u2019re trying to read something you don\u2019t have a link for then don\u2019t try making up a link. Instead try calling the \`search_alpine\` tool which will help you find what you need and will give you links which you can use with the \`read_link\` tool.`,
    });
}
