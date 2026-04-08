import {addHours} from "date-fns";
import {Root} from "mdast";
import * as prettier from "prettier";
import * as markdownPrettierPlugin from "prettier/plugins/markdown";
import {parseAgentWebBytes} from "~/server/agents/web/agent_web_bytes.js";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {truncateAgentWebReadResponse} from "~/server/agents/web/call_agent_web_read_more_tool.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.js";
import {
    printAgentWebDocumentPage,
    readAgentWebDocumentPage,
} from "~/server/agents/web/pages/agent_web_document_page.js";
import {printMarkdownTree} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {NotFoundError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

export const agentWebReadResponseExpirationHours = 1;

export async function callAgentWebReadTool(
    context: AgentWebContext,
    {path: originalPath, limit: limitBytesString}: {path: string; limit: string},
) {
    const {path, pathname} = normalizeAgentWebPath(originalPath);
    const limitBytes = parseAgentWebBytes(limitBytesString);

    const pageLink = await context.storage.pageLinkByPathname.get(pathname);

    if (!pageLink) {
        throw new NotFoundError("Link not found", {
            displayMessage: errorDisplayMessage`Nothing found for path \`${originalPath}\`. You may only read paths you\u2019ve already seen a link for. Please try calling the \`read\` tool again with a path you\u2019ve seen before. If you\u2019re trying to read something you don\u2019t have a link for then don\u2019t try making up a path. Instead try calling the \`search\` tool which will help you find what you need and will give you links which you can use with the \`read\` tool.`,
        });
    }

    let response: Root;

    switch (pageLink.type) {
        case "Document": {
            const page = await readAgentWebDocumentPage(context, pageLink.id);

            response = await printAgentWebDocumentPage(context.storage, pageLink.id, page);
            break;
        }
        default:
            throw exhaustive(pageLink);
    }

    // Use Prettier to print our Markdown before sending it to the LLM. We hypothesize
    // this will lead to better performance from the LLM since Prettier formatting is
    // more "standard" than micromark's (used by `printMarkdownTree()`) default
    // formatting.
    //
    // To directly provide our Markdown AST to Prettier we provide an empty string and
    // a plugin that simply returns the `mdast` AST which Prettier understands how to
    // print. This way we don't have to call `printMarkdownTree()` only for Prettier to
    // immediately parse it back into an AST.
    let responseString = await prettier.format("ignored", {
        parser: "mdast",
        endOfLine: "lf",
        printWidth: 80,
        tabWidth: 2,
        proseWrap: "never",
        plugins: [
            {
                parsers: {
                    mdast: {
                        parse: () => response,
                        astFormat: "mdast",
                        locStart: node => node.position?.start?.offset ?? 0,
                        locEnd: node => node.position?.end?.offset ?? 0,
                    },
                },
            },
            markdownPrettierPlugin,
        ],
    });

    responseString = responseString.trim();

    const encoder = new TextEncoder();
    const responseBytes = encoder.encode(responseString);

    // Find all the newline indexes in our response. So the `read_more` tool can easily
    // return a slice of the response.
    const newlineByteIndexes: Array<number> = [];

    for (let index = 0; index < responseBytes.length; index++) {
        if (responseBytes[index] === 10) {
            newlineByteIndexes.push(index);
        }
    }

    // There's implicitly a newline at the end of the response. This also allows
    // `newlineByteIndexes` to be non-empty.
    newlineByteIndexes.push(responseBytes.length);

    await context.storage.readResponseByPath.put(path, {
        expirationTime: addHours(new Date(), agentWebReadResponseExpirationHours),
        responseBytes,
        newlineByteIndexes,
    });

    if (responseBytes.length <= limitBytes) {
        return responseString;
    } else {
        return truncateAgentWebReadResponse(
            {responseBytes, newlineByteIndexes},
            {offsetLine: 0, limitBytes},
        );
    }
}
