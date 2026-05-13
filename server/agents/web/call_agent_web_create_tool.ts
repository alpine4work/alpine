import {addHours} from "date-fns";
import {Root} from "mdast";
import {stemmer} from "stemmer";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {AgentWebPageMetadata} from "~/server/agents/web/agent_web_page.js";
import {
    AgentWebPageLink,
    printAgentWebPageLinkLabel,
} from "~/server/agents/web/agent_web_page_link.js";
import {agentWebReadResponseExpirationHours} from "~/server/agents/web/call_agent_web_read_tool.js";
import {createAgentWebPageLinkPathname} from "~/server/agents/web/internal/create_agent_web_page_link_pathname.js";
import {quoteMarkdown} from "~/server/agents/web/internal/quote_markdown.js";
import {
    createAgentWebDocumentPage,
    parseAgentWebDocumentPage,
} from "~/server/agents/web/pages/agent_web_document_page.js";
import {parseMarkdownTree} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {printMarkdownTree} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";

export async function callAgentWebCreateTool(
    context: AgentWebContext,
    {
        type,
        content,
    }: {
        type: string;
        content: string;
    },
): Promise<string> {
    const contentTree = parseMarkdownTree(content);

    const {noun, pageMetadata, pageLink} = await createAgentWebPageLink(context, type, contentTree);
    const pageLinkPathname = await createAgentWebPageLinkPathname(context.storage, pageLink);

    // Find all the newline indexes in our content. So the `scroll` tool can easily
    // return a slice of the content.
    const newlineIndexes: Array<number> = [];

    for (let index = 0; index < content.length; index++) {
        if (content[index] === "\n") {
            newlineIndexes.push(index);
        }
    }

    // There's implicitly a newline at the end of the content. This also means
    // `newlineIndexes` is non-empty.
    newlineIndexes.push(content.length);

    // Add the exact content to storage so the agent can call `update` and `scroll`
    // tools on the content.
    await getOrSetDefaultMapValue(
        context.storage.readResponseMutexByPath,
        pageLinkPathname,
        () => new Mutex(),
    ).withLock(async () => {
        await context.storage.readResponseByPath.put(pageLinkPathname, {
            expirationTime: addHours(new Date(), agentWebReadResponseExpirationHours),
            pageMetadata,
            response: content,
            newlineIndexes,
        });
    });

    return (
        printMarkdownTree({
            type: "root",
            children: [
                {
                    type: "paragraph",
                    children: [
                        {type: "text", value: `Create was successful. New ${noun}: `},
                        {
                            type: "link",
                            url: pageLinkPathname,
                            children: [{type: "text", value: printAgentWebPageLinkLabel(pageLink)}],
                        },
                        {type: "text", value: "."},
                    ],
                },
            ],
        }).trimEnd() + "\n"
    );
}

async function createAgentWebPageLink(
    context: AgentWebContext,
    originalType: string,
    content: Root,
): Promise<{noun: string; pageMetadata: AgentWebPageMetadata; pageLink: AgentWebPageLink}> {
    // Stem and lowercase whatever random stuff the agent decides to throw at us.
    // Though we tell the agent to use whatever is in the path prefix (e.g. `document`
    // in `/document/cool-thing`, but we want to support `documents`).
    const type = stemmer(originalType.toLowerCase());

    switch (type) {
        case "doc":
        case "document": {
            const newPage = await parseAgentWebDocumentPage(context.storage, null, content);

            const newPageMetadata = await createAgentWebDocumentPage(
                context,
                context.spaceId,
                newPage,
            );

            return {
                noun: "document",
                pageMetadata: newPageMetadata,
                pageLink: {
                    type: "Document",
                    id: newPageMetadata.id,
                    title: newPage.title,
                },
            };
        }
        default: {
            const quotedType = quoteMarkdown([{type: "text", value: originalType}]);

            throw new InvalidArgumentError("Can\u2019t create unrecognized `type`", {
                // NOCOMMIT: Include a link to a skill that says all the stuff you can create!
                displayMessage: errorDisplayMessage`Unrecognized \`type\` ${quotedType}.`,
            });
        }
    }
}
