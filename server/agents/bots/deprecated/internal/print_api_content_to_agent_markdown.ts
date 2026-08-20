import {Heading, Parent, Root} from "mdast";
import {AgentLink} from "~/server/agents/bots/deprecated/internal/link_references/agent_link.js";
import {createAgentLink} from "~/server/agents/bots/deprecated/internal/link_references/agent_link_collection.js";
import {
    printAgentLinkPath,
    printAgentPlainTextLabel,
} from "~/server/agents/bots/deprecated/internal/link_references/print_agent_link_path.js";
import {DurableObjectStorageInterface} from "~/server/cloudflare/durable_object_storage_collection.js";
import {
    printApiContentToMarkdownTree,
    printMarkdownTree,
} from "~/shared/api/content/print_api_content_to_markdown.open_source.js";
import {
    ApiContentMentionInlineElement,
    ApiContentWithoutKeys,
} from "~/shared/api/specification/types/api_specification_convenience_types.open_source.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";

/**
 * Print API content to Markdown for an agent. Strips some Markdown formatting that
 * we think is too technical for an LLM. For example, removes URLs from links. We
 * give LLMs a tool to read content from links.
 *
 * @deprecated Use similar behavior from `server/agents/web` instead.
 */
export async function printApiContentToAgentMarkdown(
    storage: DurableObjectStorageInterface,
    content: ApiContentWithoutKeys,
) {
    const markdownTree = await printApiContentToAgentMarkdownTree(storage, content);
    return printAgentContentMarkdownTree(markdownTree);
}

/**
 * Print API content to Markdown for an agent. Strips some Markdown formatting that
 * we think is too technical for an LLM. For example, removes URLs from links. We
 * give LLMs a tool to read content from links.
 *
 * @deprecated Use similar behavior from `server/agents/web` instead.
 */
export async function printApiContentToAgentMarkdownTree(
    storage: DurableObjectStorageInterface,
    content: ApiContentWithoutKeys,
) {
    const promiseWaiter = new PromiseWaiter();

    const markdownTree = printApiContentToMarkdownTree(content, {
        withCommentTagHtml: true,
    });

    const traverse = (node: Parent) => {
        // Headings from `ApiContentRequest` should always start at level 2. That way we
        // can add level 1 headings elsewhere in the agent context (e.g. document titles)
        // without fear of conflict.
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
                        mentionElement as ApiContentMentionInlineElement,
                    );

                    node.children[index] = {
                        type: "link",
                        url: printAgentLinkPath(link),
                        children: [{type: "text", value: printAgentPlainTextLabel(link)}],
                    };
                });
                continue;
            }

            if (childNode.type === "html") {
                // The legacy bot format intentionally hides document comment thread IDs.
                childNode.value = childNode.value.replace(/^<comment id="[^"]+">$/, "<comment>");

                // Throw away links encoded as anchor tags (`<a>`).
                if (/<a[^a-zA-Z0-9]/.test(childNode.value)) {
                    childNode.value = childNode.value.replaceAll(
                        /href="[^"]*"/g,
                        'href="missing-link"',
                    );
                }
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
 *
 * @deprecated Use similar behavior from `server/agents/web` instead.
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
    mentionElement: ApiContentMentionInlineElement,
): Promise<AgentLink> {
    const {reference} = mentionElement;

    switch (reference.type) {
        case "Account": {
            return createAgentLink(storage, {
                type: "Account",
                account: {
                    id: reference.id,
                    name: reference.title,
                },
            });
        }
        case "Channel": {
            return createAgentLink(storage, {
                type: "Channel",
                channel: {
                    id: reference.id,
                    name: reference.title,
                },
            });
        }
        case "Chat": {
            return createAgentLink(storage, {
                type: "Chat",
                chat: {
                    id: reference.id,
                    name: reference.title,
                },
            });
        }
        case "Document": {
            return createAgentLink(storage, {
                type: "Document",
                document: {
                    id: reference.id,
                    title: reference.title,
                },
            });
        }
        case "Post": {
            return createAgentLink(storage, {
                type: "Post",
                post: {
                    id: reference.id,
                    contentPreview: reference.title,
                },
            });
        }
        case "Site": {
            return createAgentLink(storage, {
                type: "Site",
                site: {
                    id: reference.id,
                    name: reference.title,
                },
            });
        }
        case "Task": {
            return createAgentLink(storage, {
                type: "Task",
                task: {
                    id: reference.id,
                    title: reference.title,
                    status: reference.status,
                },
            });
        }
        case "TaskCollection": {
            return createAgentLink(storage, {
                type: "TaskCollection",
                taskCollection: {
                    id: reference.id,
                    name: reference.title,
                },
            });
        }
        default: {
            throw exhaustive(reference);
        }
    }
}
