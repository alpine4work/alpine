import {Parent} from "mdast";
import {DurableObjectStorageInterface} from "~/server/agents/internal/durable_object_storage_collection.js";
import {AgentLink} from "~/server/agents/internal/link_references/agent_link.js";
import {createAgentLink} from "~/server/agents/internal/link_references/agent_link_collection.js";
import {
    printAgentLinkPath,
    printAgentPlainTextLabel,
} from "~/server/agents/internal/link_references/print_agent_link_path.js";
import {
    printApiContentToMarkdownTree,
    printMarkdownTree,
} from "~/server/api/markdown/print_api_content_to_markdown.js";
import {
    ApiContentMentionInlineElementResponse,
    ApiContentResponse,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

/**
 * Print API content to Markdown for an agent. Strips some Markdown formatting
 * that we think is too technical for an LLM. For example, removes URLs from
 * links. We give LLMs a tool to read content from links.
 */
export async function printAgentContentToMarkdown(
    storage: DurableObjectStorageInterface,
    content: ApiContentResponse,
    {spaceId}: {spaceId: SpaceId},
) {
    const markdownTree = await printAgentContentToMarkdownTree(storage, content, {spaceId});
    return printMarkdownTree(markdownTree);
}

/**
 * Print API content to Markdown for an agent. Strips some Markdown formatting
 * that we think is too technical for an LLM. For example, removes URLs from
 * links. We give LLMs a tool to read content from links.
 */
export async function printAgentContentToMarkdownTree(
    storage: DurableObjectStorageInterface,
    content: ApiContentResponse,
    {spaceId}: {spaceId: SpaceId},
) {
    const promiseWaiter = new PromiseWaiter();

    const markdownTree = printApiContentToMarkdownTree(content, {
        spaceId,
        // Our LLMs don't need to know the width of columns in a table. The potentially
        // long floats will consume a lot of tokens and may confuse the LLM.
        withoutTableWidth: true,
    });

    const traverse = (node: Parent) => {
        for (let index = 0; index < node.children.length; index++) {
            const childNode = node.children[index]!;

            // Convert links into a more token efficient representation. The HTTP URL
            // syntax consumes a lot of tokens and isn't interesting for LLMs.
            if (childNode.type === "link") {
                // TODO(ifitzsimmons, #ai): As implemented, non-mentionable content (e.g.
                // a chat message) will be replaced with a missing link. It may make more
                // sense to create an actual link to the message when possible.
                if (!childNode.data?.mentionElement) {
                    node.children[index] = {
                        type: "linkReference",
                        referenceType: "full",
                        identifier: "missing-link",
                        children: childNode.children,
                    };
                    continue;
                }

                const {mentionElement} = childNode.data;

                promiseWaiter.waitUntil(async () => {
                    const link = await createAgentLinkForApiMentionPath(
                        storage,
                        // Since this function only accepts `ApiContentResponse`, we know the mention
                        // element should also be the response specialization.
                        mentionElement as ApiContentMentionInlineElementResponse,
                    );

                    node.children[index] = {
                        type: "link",
                        url: printAgentLinkPath(link),
                        children: [{type: "text", value: printAgentPlainTextLabel(link)}],
                    };
                });
                continue;
            }

            // Throw away links encoded as anchor tags (`<a>`).
            if (childNode.type === "html" && /<a[^a-zA-Z0-9]/.test(childNode.value)) {
                childNode.value = childNode.value.replaceAll(
                    /href="[^"]*"/g,
                    // eslint-disable-next-line string-quotes
                    'href="missing-link"',
                );
            }

            if ("children" in childNode) {
                traverse(childNode);
            }
        }
    };

    traverse(markdownTree);

    // Wait for all promises to resolve...
    await promiseWaiter.wait();

    return markdownTree;
}

function createAgentLinkForApiMentionPath(
    storage: DurableObjectStorageInterface,
    mentionElement: ApiContentMentionInlineElementResponse,
): Promise<AgentLink> {
    switch (mentionElement.target.type) {
        case "Account": {
            return createAgentLink(storage, {
                type: "Account",
                account: {
                    id: mentionElement.target.id,
                    name: mentionElement.title,
                },
            });
        }
        case "Channel": {
            return createAgentLink(storage, {
                type: "Channel",
                channel: {
                    id: mentionElement.target.id,
                    name: mentionElement.title,
                },
            });
        }
        case "Document": {
            return createAgentLink(storage, {
                type: "Document",
                document: {
                    id: mentionElement.target.id,
                    title: mentionElement.title,
                },
            });
        }
        case "Post": {
            return createAgentLink(storage, {
                type: "Post",
                post: {
                    id: mentionElement.target.id,
                    contentPreview: mentionElement.title,
                },
            });
        }
        case "Task": {
            return createAgentLink(storage, {
                type: "Task",
                task: {
                    id: mentionElement.target.id,
                    title: mentionElement.title,
                    status: mentionElement.target.status,
                },
            });
        }
        case "TaskCollection": {
            return createAgentLink(storage, {
                type: "TaskCollection",
                taskCollection: {
                    id: mentionElement.target.id,
                    name: mentionElement.title,
                },
            });
        }
        default: {
            throw exhaustive(mentionElement.target);
        }
    }
}
