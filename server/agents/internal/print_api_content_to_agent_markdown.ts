import {Heading, Parent, Root} from "mdast";
import {DurableObjectStorageInterface} from "~/server/agents/internal/durable_object_storage_collection.js";
import {AgentLink} from "~/server/agents/internal/link_references/agent_link.js";
import {createAgentLink} from "~/server/agents/internal/link_references/agent_link_collection.js";
import {
    printAgentLinkPath,
    printAgentPlainTextLabel,
} from "~/server/agents/internal/link_references/print_agent_link_path.js";
import {ApiContentResponseWithoutKeys} from "~/shared/api/content/into_api_content.js";
import {
    printApiContentToMarkdownTree,
    printMarkdownTree,
} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {ApiContentMentionInlineElementResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";

/**
 * Print API content to Markdown for an agent. Strips some Markdown formatting that
 * we think is too technical for an LLM. For example, removes URLs from links. We
 * give LLMs a tool to read content from links.
 */
export async function printApiContentToAgentMarkdown(
    storage: DurableObjectStorageInterface,
    content: ApiContentResponseWithoutKeys,
) {
    const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);
    return printAgentContentMarkdownTree(markdownTree);
}

/**
 * Print API content to Markdown for an agent. Strips some Markdown formatting that
 * we think is too technical for an LLM. For example, removes URLs from links. We
 * give LLMs a tool to read content from links.
 */
export async function printApiContentToAgentMarkdownTree(
    storage: DurableObjectStorageInterface,
    content: ApiContentResponseWithoutKeys,
) {
    const promiseWaiter = new PromiseWaiter();

    const markdownTree = printApiContentToMarkdownTree(content, {
        // Our LLMs don't need to know the width of columns in a table. The potentially
        // long floats will consume a lot of tokens and may confuse the LLM.
        withoutTableWidth: true,
        withSimpleCommentMarkHtml: true,
    });

    const traverse = (node: Parent) => {
        // Headings from `ApiContent` should always start at level 2. That way we can add
        // level 1 headings elsewhere in the agent context (e.g. document titles) without
        // fear of conflict.
        if (node.type === "heading") {
            (node as Heading).depth += 1;
        }

        for (let index = 0; index < node.children.length; index++) {
            const childNode = node.children[index]!;

            // Convert links into a more token efficient representation. The HTTP URL syntax
            // consumes a lot of tokens and isn't interesting for LLMs.
            if (childNode.type === "link") {
                // TODO(ifitzsimmons, #ai): As implemented, non-mentionable content (e.g. a chat
                // message) will be replaced with a missing link. It may make more sense to create
                // an actual link to the message when possible.
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
                        // Since this function only accepts response-shaped API content, we know the
                        // mention element should also be the response specialization.
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

/**
 * Agent content includes html tags for things such as wrapping messages from a
 * user. For example, a message from Alice looks like
 *
 * ```html
 * <human name="Alice"> {markdownContent} </human>
 * ```
 *
 * The problem is that `printMarkdownTree` adds new lines around each markdown
 * "block". So the above example actually looks like the following (assuming the
 * content is a paragraph with text "Hello!"):
 *
 * ```html
 * <human name="Alice"> Hello! </human>
 * ```
 *
 * The new lines are technically correct, but are not useful for the LLM. They also
 * make the log harder to read. This function strips new lines after opening
 * message tags and before closing message tags.
 */
export function printAgentContentMarkdownTree(markdownRoot: Root): string {
    const markdownString = printMarkdownTree(markdownRoot);

    return markdownString
        .replaceAll(/^(<(?:human|bot|blockquote|document_preview)(?:>| [^>]*>))\n/gm, "$1")
        .replaceAll(/\n(<\/(?:human|bot|blockquote|document_preview)(?:>| [^>]*>))$/gm, "$1")
        .replaceAll(/\\(\[…\])$/gm, "$1");
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
        case "Chat": {
            return createAgentLink(storage, {
                type: "Chat",
                chat: {
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
        case "Site": {
            return createAgentLink(storage, {
                type: "Site",
                site: {
                    id: mentionElement.target.id,
                    name: mentionElement.title,
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
