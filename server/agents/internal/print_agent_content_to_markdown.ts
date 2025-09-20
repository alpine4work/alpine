import {Parent} from "mdast";
import {
    DurableObjectStorageCollection,
    DurableObjectStorageInterface,
    DurableObjectTransactionInterface,
} from "~/server/agents/internal/durable_object_storage_collection.js";
import {printMarkdownPhrasingContentText} from "~/server/api/markdown/agent_message_stream.js";
import {parseApiContentMentionInlineElementTargetPathIfPossible} from "~/server/api/markdown/parse_api_content_from_markdown.js";
import {
    printApiContentToMarkdownTree,
    printMarkdownTree,
} from "~/server/api/markdown/print_api_content_to_markdown.js";
import {
    ApiContent,
    ApiContentMentionInlineElementTargetPath,
} from "~/shared/api/types/api_specification_convenience_types.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {PromiseWaiter} from "~/shared/helpers/async/promise_waiter.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {SpaceId} from "~/shared/id/types/id_types.js";

export type AgentConversationLinkReference = {
    readonly mentionTargetPath: ApiContentMentionInlineElementTargetPath;
};

const AgentContentLinkReferenceCollection = new DurableObjectStorageCollection<
    string,
    AgentConversationLinkReference
>("a3");

export function listAgentContentLinkReferences(
    storage: DurableObjectStorageInterface,
): Promise<Map<string, AgentConversationLinkReference>> {
    return AgentContentLinkReferenceCollection.list(storage);
}

export function getAgentContentLinkReference(
    storage: DurableObjectStorageInterface,
    label: string,
): Promise<AgentConversationLinkReference | undefined> {
    return AgentContentLinkReferenceCollection.get(storage, label);
}

export type AgentConversationLink = {
    readonly originalLabel: string;
    readonly reference: AgentConversationLinkReference;
    readonly label: string;
    readonly getEscapedLabel: () => string;
};

let putAgentContentLinkReferenceMutex: Mutex | null = null;

export async function putAgentContentLinkReference(
    storage: DurableObjectStorageInterface,
    originalLabel: string,
    reference: AgentConversationLinkReference,
): Promise<AgentConversationLink> {
    // Use a process-wide mutex to avoid concurrent calls writing different
    // mentions to the same label. This will be the only process ever writing to
    // storage so a process-wide mutex is safe.
    const run = (transaction: DurableObjectTransactionInterface) => {
        putAgentContentLinkReferenceMutex ??= new Mutex();

        return putAgentContentLinkReferenceMutex.withLock(async () => {
            let dedupeNumber = 1;
            let label = originalLabel;

            while (true) {
                // Check if this link label is unused or if
                const existingReference = await AgentContentLinkReferenceCollection.get(
                    transaction,
                    label,
                );
                if (existingReference === undefined) break;
                if (existingReference.mentionTargetPath === reference.mentionTargetPath) break;

                dedupeNumber += 1;
                label = `${originalLabel} ${dedupeNumber}`;
            }

            await AgentContentLinkReferenceCollection.put(transaction, label, reference);

            return {
                label,
                getEscapedLabel: () => escapeMarkdownLinkLabel(label),
                originalLabel,
                reference,
            };
        });
    };

    // Make sure we're running in a transaction in addition to the process-wide
    // mutex to really make sure we're not writing to the same label concurrently.
    if ("rollback" in storage) {
        return run(storage);
    } else {
        return storage.transaction(run);
    }
}

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

                promiseWaiter.waitUntil(async () => {
                    const {label} = await putAgentContentLinkReference(storage, originalLinkLabel, {
                        mentionTargetPath,
                    });

                    node.children[index] = {
                        type: "linkReference",
                        referenceType: "collapsed",
                        identifier: "",
                        children: [{type: "text", value: label}],
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

/**
 * Escapes a string so it can be used as a Markdown link label.
 */
function escapeMarkdownLinkLabel(contents: string): string {
    const markdown = printMarkdownTree({
        type: "root",
        children: [
            {
                type: "linkReference",
                referenceType: "collapsed",
                identifier: "",
                children: [{type: "text", value: contents}],
            },
        ],
    }).trim();

    assert(markdown.startsWith("["));
    assert(markdown.endsWith("][]"));

    return markdown.slice(1, -3);
}
