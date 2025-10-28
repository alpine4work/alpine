import {Parent} from "mdast";
import {DurableObjectStorageInterface} from "~/server/agents/internal/durable_object_storage_collection.js";
import {AgentLink} from "~/server/agents/internal/link_references/agent_link.js";
import {
    createAgentLink,
    printEscapedMarkdownLinkLabel,
} from "~/server/agents/internal/link_references/agent_link_collection.js";
import {printAgentLinkPath} from "~/server/agents/internal/link_references/print_agent_link_path.js";
import {printMarkdownPhrasingContentText} from "~/server/api/markdown/agent_message_stream.js";
import {parseApiContentMentionInlineElementTargetPathIfPossible} from "~/server/api/markdown/parse_api_content_from_markdown.js";
import {
    printApiContentToMarkdownTree,
    printMarkdownTree,
} from "~/server/api/markdown/print_api_content_to_markdown.js";
import {parseApiMentionPath} from "~/shared/api/parse_api_path.js";
import {
    ApiContent,
    ApiMentionPath,
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
    content: ApiContent,
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
    content: ApiContent,
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
                // Try parsing URL.
                let url: URL | undefined;
                try {
                    url = new URL(childNode.url);
                } catch {
                    // noop
                }

                // TODO(ifitzsimmons, #ai): As implemented, non-mentionable content (e.g.
                // a chat message) will be replaced with a missing link. It may make more
                // sense to create an actual link to the message when possible.
                const mentionTargetPath = url
                    ? parseApiContentMentionInlineElementTargetPathIfPossible(spaceId, url)
                    : null;

                if (mentionTargetPath === null) {
                    node.children[index] = {
                        type: "linkReference",
                        referenceType: "full",
                        identifier: "missing-link",
                        children: childNode.children,
                    };
                    continue;
                }

                // If this is a mention then remove the URL but keep the link structure (e.g.
                // `[Dinosaurs aren't Great](documents/dinosaurs-arent-Great)`). We'll give agents a tool to
                // load links based on the formatted link.
                const rawOriginalLinkLabel = printMarkdownPhrasingContentText(childNode.children);

                promiseWaiter.waitUntil(async () => {
                    const link = await createAgentLinkForApiMentionPath(
                        storage,
                        mentionTargetPath,
                        rawOriginalLinkLabel,
                    );

                    node.children[index] = {
                        type: "link",
                        url: printAgentLinkPath(link),
                        children: [{type: "text", value: printEscapedMarkdownLinkLabel(link)}],
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
    targetPath: ApiMentionPath,
    rawOriginalLinkLabel: string,
): Promise<AgentLink> {
    const pathObject = parseApiMentionPath(targetPath);

    switch (pathObject.type) {
        case "Account": {
            return createAgentLink(storage, {
                type: "Account",
                account: {
                    id: pathObject.accountId,
                    name: rawOriginalLinkLabel,
                },
            });
        }
        case "Channel": {
            return createAgentLink(storage, {
                type: "Channel",
                channel: {
                    id: pathObject.channelId,
                    name: rawOriginalLinkLabel,
                },
            });
        }
        case "Document": {
            return createAgentLink(storage, {
                type: "Document",
                document: {
                    id: pathObject.documentId,
                    title: rawOriginalLinkLabel,
                },
            });
        }
        case "Post": {
            return createAgentLink(storage, {
                type: "Post",
                post: {
                    id: pathObject.postId,
                    contentPreview: rawOriginalLinkLabel,
                },
            });
        }
        case "Task": {
            return createAgentLink(storage, {
                type: "Task",
                task: {
                    id: pathObject.taskId,
                    title: rawOriginalLinkLabel,
                },
            });
        }
        case "TaskCollection": {
            return createAgentLink(storage, {
                type: "TaskCollection",
                taskCollection: {
                    id: pathObject.collectionId,
                    name: rawOriginalLinkLabel,
                },
            });
        }
        default: {
            throw exhaustive(pathObject);
        }
    }
}
