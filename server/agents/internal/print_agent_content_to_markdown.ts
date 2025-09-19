import {Literal, Parent, PhrasingContent} from "mdast";
import {
    DurableObjectStorageCollection,
    DurableObjectStorageInterface,
    DurableObjectTransactionInterface,
} from "~/server/agents/internal/durable_object_storage.js";
import {parseApiContentMentionInlineElementTargetPathIfPossible} from "~/server/api/markdown/parse_api_content_from_markdown.js";
import {
    printApiContentToMarkdownTree,
    printMarkdownTree,
} from "~/server/api/markdown/print_api_content_to_markdown.js";
import {
    ApiContent,
    ApiContentMentionInlineElementTargetPath,
} from "~/server/api/specification/types/api_specification_convenience_types.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export type ChatGptAgentConversationReference = {
    readonly mentionTargetPath: ApiContentMentionInlineElementTargetPath;
};

const AgentContentLinkReferenceCollection = new DurableObjectStorageCollection<
    string,
    ChatGptAgentConversationReference
>("a3");

export function listAgentContentLinkReferences(
    storage: DurableObjectStorageInterface,
): Promise<Map<string, ChatGptAgentConversationReference>> {
    return AgentContentLinkReferenceCollection.list(storage);
}

/**
 * Print API content to Markdown for an agent. Strips some Markdown formatting
 * that we think is too technical for an LLM. For example, removes URLs from
 * links. We give LLMs a tool to read content from links.
 */
export async function printAgentContentToMarkdown(
    transaction: DurableObjectTransactionInterface,
    content: ApiContent,
    {spaceId}: {spaceId: SpaceId},
) {
    const mutex = new Mutex();
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
                // `[My Document][]`). We'll give agents a tool to load links based on the
                // link label.

                const originalLinkLabel = printMarkdownPhrasingContentText(childNode.children);

                let dedupeNumber = 1;
                let linkLabel = originalLinkLabel;

                promiseWaiter.waitUntil(async () => {
                    // Use a mutex so there aren't any issues with links running concurrently trying
                    // to claim a unique label. This function as a whole is running inside a
                    // `DurableObjectTransaction` which should protect us from other function calls
                    // running concurrently and messing with this
                    // `printAgentContentToMarkdown()` call.
                    await mutex.withLock(async () => {
                        while (true) {
                            // Check if this link label is unused or if
                            const existingLinkReference =
                                await AgentContentLinkReferenceCollection.get(
                                    transaction,
                                    linkLabel,
                                );
                            if (existingLinkReference === undefined) break;
                            if (existingLinkReference.mentionTargetPath === mentionTargetPath)
                                break;

                            dedupeNumber += 1;
                            linkLabel = `${originalLinkLabel} ${dedupeNumber}`;
                        }

                        await AgentContentLinkReferenceCollection.put(transaction, linkLabel, {
                            mentionTargetPath,
                        });
                    });

                    node.children[index] = {
                        type: "linkReference",
                        referenceType: "collapsed",
                        identifier: "",
                        children: [{type: "text", value: linkLabel}],
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

    return printMarkdownTree(markdownTree);
}

function printMarkdownPhrasingContentText(contents: ReadonlyArray<PhrasingContent>): string {
    let text = "";

    const print = (contents: ReadonlyArray<PhrasingContent | (Literal & {type: "inlineMath"})>) => {
        for (const content of contents) {
            switch (content.type) {
                case "text":
                case "inlineCode":
                case "inlineMath": {
                    text += content.value;
                    break;
                }
                case "link":
                case "delete":
                case "emphasis":
                case "linkReference":
                case "strong": {
                    print(content.children);
                    break;
                }
                case "break":
                case "footnoteReference":
                case "html":
                case "image":
                case "imageReference": {
                    break;
                }
                default:
                    throw exhaustive(content);
            }
        }
    };

    print(contents);

    return text;
}
