import escapeHtml from "escape-html";
import {Link} from "mdast";
import {createApiMessage} from "~/server/agents/api/api_client.js";
import {AgentWebContextWithoutStorage} from "~/server/agents/web/agent_web_context.js";
import {
    AgentWebMessagingPage,
    AgentWebMessagingPageBlock,
    AgentWebMessagingPageMetadata,
    AgentWebMessagingPageNouns,
    AgentWebMessagingPagePagination,
} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {printAgentWebMessagingPageMessageIndexRange} from "~/server/agents/web/pages/messaging/print_agent_web_messaging_page.js";
import {
    normalizeApiContent,
    normalizeApiTarget,
} from "~/shared/api/markdown/normalize_api_content.js";
import {printMarkdownTree} from "~/shared/api/markdown/print_api_content_to_markdown.js";
import {ApiMessageRoomTarget} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {unwrapMaybeThunk} from "~/shared/helpers/control/unwrap_maybe_thunk.js";
import {reverseIterable} from "~/shared/helpers/iterable/reverse_iterable.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.js";

export const updateAgentWebMessagingPageUnexpectedNewMessageIndexesErrorMessage =
    "Update was successful, but the agent needs to know there were some other messages added it hasn\u2019t observed";

export async function updateAgentWebMessagingPage<Preamble>(
    context: AgentWebContextWithoutStorage,
    {
        messageNouns,
        pathname,
        room,
        oldPageMetadata,
        oldPage,
        newPage,
    }: {
        messageNouns: AgentWebMessagingPageNouns;
        pathname: MaybeThunk<MaybePromise<string>>;
        room: MaybeThunk<MaybePromise<ApiMessageRoomTarget>>;
        oldPageMetadata: MaybeThunk<MaybePromise<AgentWebMessagingPageMetadata>>;
        oldPage: AgentWebMessagingPage<Preamble>;
        newPage: AgentWebMessagingPage<Preamble>;
    },
): Promise<AgentWebMessagingPageMetadata> {
    const updateThunks: Array<() => Promise<void>> = [];
    const createThunks: Array<() => Promise<{index: number}>> = [];

    // Strip response properties from the preamble before comparing for equality. We
    // don't care if `target.title`s aren't equal. The `title` might have changed
    // between the old page load time and new page generation time.
    const normalizePagination = (pagination: AgentWebMessagingPagePagination | null) => {
        if (!pagination) return null;

        return {
            ...pagination,
            target: normalizeApiTarget(pagination.target),
        };
    };

    if (
        !isDeepEqual(
            normalizePagination(oldPage.pagination),
            normalizePagination(newPage.pagination),
        )
    ) {
        throw new InvalidArgumentError("Can\u2019t update messaging page preamble", {
            displayMessage: errorDisplayMessage`You can only update your \`<${messageNouns.noun}>\`s. You can\u2019t update the previous/next page links in the ${messageNouns.pluralNoun} markdown. Try again with a more specific update that only changes the content of ${messageNouns.pluralNoun} from you or adds new ${messageNouns.pluralNoun}.`,
        });
    }

    const commonBlocksLength = Math.min(oldPage.blocks.length, newPage.blocks.length);

    let fallbackMessageIndex = newPage.pagination?.previousLink?.beforeMessageIndex ?? 0;

    for (let index = 0; index < commonBlocksLength; index++) {
        const oldBlock = oldPage.blocks[index]!;
        const newBlock = newPage.blocks[index]!;

        if (newBlock.type === "Message") {
            if (newBlock.idAttribute) {
                fallbackMessageIndex = newBlock.idAttribute.endMessageIndex;
            } else {
                fallbackMessageIndex++;
            }
        }

        // Strip response properties from the block before comparing for equality. We don't
        // care if `target.title`s aren't equal. The `title` might have changed between the
        // old page load time and new page generation time.
        const normalizeBlock = (block: AgentWebMessagingPageBlock) => {
            if (block.type === "Time") return block;

            return {
                type: "Message",
                idAttribute: block.idAttribute,
                author: normalizeApiTarget(block.author),
                timeAttribute: block.timeAttribute,
                timeZoneAttribute: block.timeZoneAttribute,
                parent: block.parent
                    ? {
                          citeAttribute: block.parent.citeAttribute,
                          author: normalizeApiTarget(block.parent.author),
                          previewContent: normalizeApiContent(block.parent.previewContent),
                      }
                    : null,
                content: normalizeApiContent(block.content),
            };
        };

        const normalizedOldBlock = normalizeBlock(oldBlock);
        const normalizedNewBlock = normalizeBlock(newBlock);

        if (isDeepEqual(normalizedOldBlock, normalizedNewBlock)) continue;

        if (
            normalizedOldBlock.type !== "Message" ||
            normalizedOldBlock.author.id !== context.botAccount.id ||
            normalizedNewBlock.type !== "Message" ||
            normalizedNewBlock.author.id !== context.botAccount.id
        ) {
            if (normalizedOldBlock.type !== "Message" || normalizedNewBlock.type !== "Message") {
                throw new InvalidArgumentError(
                    "Can\u2019t update message created by someone else",
                    {
                        displayMessage: errorDisplayMessage`You can only update your \`<${messageNouns.noun}>\`s. You can\u2019t update \`<time>\`s which indicate when previous \`<${messageNouns.noun}>\`s were sent. Try again with a more specific update that only changes the content of ${messageNouns.pluralNoun} from you or adds new ${messageNouns.pluralNoun}.`,
                    },
                );
            } else {
                assert(oldBlock.type === "Message");
                assert(newBlock.type === "Message");

                if (normalizedOldBlock.author.id !== context.botAccount.id) {
                    throw new InvalidArgumentError(
                        "Can\u2019t update message created by someone else",
                        {
                            displayMessage: errorDisplayMessage`You can only update your \`<${messageNouns.noun}>\`s. You can\u2019t update a \`<${messageNouns.noun}>\` created by ${oldBlock.author.shortName}. \`<${messageNouns.noun}${normalizedOldBlock.idAttribute ? ` id="${printAgentWebMessagingPageMessageIndexRange(normalizedOldBlock.idAttribute)}"` : ""} from="${escapeHtml(oldBlock.author.shortName)}">\` was changed by this update. Try again with a more specific update that only changes the content of ${messageNouns.pluralNoun} from you or adds new ${messageNouns.pluralNoun}.`,
                        },
                    );
                } else {
                    // Going to continue from here. The `if (isDeepEqual(...))` immediately below will
                    // throw in this case and will produce a much better error message.
                }
            }
        }

        if (
            !isDeepEqual(
                omitObject(normalizedOldBlock, ["content"]),
                omitObject(normalizedNewBlock, ["content"]),
            )
        ) {
            throw new InvalidArgumentError("Can\u2019t update message created by someone else", {
                displayMessage: errorDisplayMessage`You can only update the content of your \`<${messageNouns.noun}>\`s. Any metadata (the \`id\`/\`from\`/\`time\` attributes or \`<blockquote cite>\`) must be left unchanged. The metadata of \`<${messageNouns.noun}${normalizedOldBlock.idAttribute ? ` id="${printAgentWebMessagingPageMessageIndexRange(normalizedOldBlock.idAttribute)}"` : ""}>\` was changed by this update. Try again with a more specific update that only changes the content of ${messageNouns.pluralNoun} from you.`,
            });
        }

        const idAttribute = normalizedNewBlock.idAttribute ?? {
            startMessageIndex: fallbackMessageIndex - 1,
            endMessageIndex: fallbackMessageIndex,
        };

        if (idAttribute.startMessageIndex !== idAttribute.endMessageIndex - 1) {
            throw new InternalError("We should never merge the current bot\u2019s messages");
        }

        updateThunks.push(async () => {
            if (
                normalizedNewBlock.content.elements.length === 0 ||
                (normalizedNewBlock.content.elements[0]!.type === "Paragraph" &&
                    normalizedNewBlock.content.elements[0].elements.length === 0)
            ) {
                // TODO(#agents-web): Implement message delete endpoint.
                throw new UnimplementedError(
                    "Message delete API endpoint hasn\u2019t been implemented yet",
                );
            } else {
                // TODO(#agents-web): Implement message update endpoint.
                throw new UnimplementedError(
                    "Message update API endpoint hasn\u2019t been implemented yet",
                );
            }
        });
    }

    if (oldPage.blocks.length > newPage.blocks.length) {
        throw new InvalidArgumentError("Can\u2019t remove messages, must delete in place", {
            displayMessage: errorDisplayMessage`You can\u2019t remove \`<${messageNouns.noun}>\`s. If you want to delete one of your \`<${messageNouns.noun}>\`s, then delete all the content of your \`<${messageNouns.noun}>\`. You can only delete your own \`<${messageNouns.noun}>\`s. Try again with a more specific update that only changes the content of ${messageNouns.pluralNoun} from you.`,
        });
    }

    let lastMessageIndex: number | null;
    let nullIdAttributeCount = 0;

    for (const block of reverseIterable(oldPage.blocks)) {
        if (block.type !== "Message") continue;
        if (block.idAttribute === null) {
            nullIdAttributeCount++;
            continue;
        }
        lastMessageIndex = block.idAttribute.endMessageIndex + nullIdAttributeCount;
        break;
    }

    lastMessageIndex ??=
        (oldPage.pagination?.previousLink?.beforeMessageIndex ?? 0) + nullIdAttributeCount;

    const expectedNewMessageIndexes: Array<number> = [];

    for (let index = commonBlocksLength; index < newPage.blocks.length; index++) {
        const newBlock = newPage.blocks[index]!;

        if (!oldPage.isEndOfMessages) {
            const actualPathname = await unwrapMaybeThunk(pathname);

            throw new InvalidArgumentError("Can only create messages on the last page", {
                displayMessage: errorDisplayMessage`You can only add a \`<${messageNouns.noun}>\` after all other ${messageNouns.pluralNoun} (${messageNouns.pluralNoun} are in chronological order). Look for \u201CEnd of ${messageNouns.pluralNoun}\u201D to know when you\u2019re at the end of a ${messageNouns.noun} list. Call the \`read\` tool with \`${actualPathname}?end\` to jump to the end of a ${messageNouns.noun} list.`,
            });
        }

        if (newBlock.type !== "Message" || newBlock.author.id !== context.botAccount.id) {
            const authorLink: Link = {
                type: "link",
                url: context.botAccount.pathname,
                children: [{type: "text", value: context.botAccount.shortName}],
            };

            throw new InvalidArgumentError("Can only create messages as own account", {
                displayMessage: errorDisplayMessage`You can only add a \`<${messageNouns.noun}>\` from yourself. Try again with a \`from\` attribute that references yourself (\`from="${escapeHtml(printMarkdownTree(authorLink).trim())}"\`).`,
            });
        }

        if (
            newBlock.idAttribute &&
            (newBlock.idAttribute.startMessageIndex !==
                lastMessageIndex + (index - commonBlocksLength) ||
                newBlock.idAttribute.endMessageIndex !==
                    lastMessageIndex + (index - commonBlocksLength) + 1)
        ) {
            throw new InvalidArgumentError(
                "Can\u2019t create message with incorrect `id` attribute",
                {
                    displayMessage: errorDisplayMessage`Invalid \`id\` attribute for new \`<${messageNouns.noun}>\`. The \`<${messageNouns.noun}>\` \`id\` attribute is an integer sequence so the next valid \`id\` is \`${lastMessageIndex + (index - commonBlocksLength)}\`. Try again with \`id="${lastMessageIndex + (index - commonBlocksLength)}"\`.`,
                },
            );
        }

        expectedNewMessageIndexes.push(
            newBlock.idAttribute?.startMessageIndex ??
                lastMessageIndex + (index - commonBlocksLength),
        );

        if (newBlock.timeAttribute) {
            throw new InvalidArgumentError("Can\u2019t set the created time of a new message", {
                displayMessage: errorDisplayMessage`You can\u2019t add a \`<${messageNouns.noun}>\` with a \`time\` attribute. The creation time of the ${messageNouns.noun} will be decided by the server. Try again without the \`time\` attribute.`,
            });
        }

        createThunks.push(async () => {
            if (newBlock.parent) {
                // TODO(#agents-web): Implement creating message with parent. There's a range of
                // options for how we can do this. From only allowing full message replies to
                // figuring out the exact range of text the agent is replying to. Going to leave
                // this unimplemented for now.
                throw new UnimplementedError(
                    "Creating message with parent as agent isn\u2019t implemented yet",
                );
            }

            if (newBlock.timeZoneAttribute) {
                // TODO(#agents-web): Implement parsing of time zone attribute.
                throw new UnimplementedError(
                    "Parsing of time zone attribute into `TimeZone` type hasn\u2019t been implemented",
                );
            }

            const {
                data: {message},
            } = await createApiMessage(context.span, context.api, actualRoom, {
                content: newBlock.content,
            });

            return {index: message.index};
        });
    }

    if (oldPage.isEndOfMessages !== newPage.isEndOfMessages) {
        if (!newPage.isEndOfMessages && createThunks.length > 0) {
            throw new InvalidArgumentError(
                "Can\u2019t remove the end of messages paragraph when creating messages",
                {
                    displayMessage: errorDisplayMessage`When you\u2019re adding a ${messageNouns.noun} you need to keep the \u201CEnd of ${messageNouns.pluralNoun}\u201D marker at the end of the ${messageNouns.noun} list below your new ${messageNouns.noun}. Try again without removing the \u201CEnd of ${messageNouns.pluralNoun}\u201D marker.`,
                },
            );
        } else {
            throw new InvalidArgumentError(
                "Can\u2019t change whether this page is the end of messages or not",
                {
                    displayMessage: errorDisplayMessage`Can\u2019t ${newPage.isEndOfMessages ? "add" : "remove"} the \u201CEnd of ${messageNouns.pluralNoun}\u201D marker in an update. Only a \`read\` tool call can tell you whether you\u2019re at the end of a ${messageNouns.noun} list or not. Try again without ${newPage.isEndOfMessages ? "adding" : "removing"} the \u201CEnd of ${messageNouns.pluralNoun}\u201D marker.`,
                },
            );
        }
    }

    // Call the `room` and `oldPageMetadata` thunks right before actually running
    // mutations. That way all validation gets a chance to run first.
    const [actualRoom, actualOldPageMetadata] = await runAllPromises([
        unwrapMaybeThunk(room),
        unwrapMaybeThunk(oldPageMetadata),
    ]);

    // Finally now that we're done validating the update, actually make all changes!
    const [, newMessages] = await runAllPromises([
        // Run all update thunks in parallel.
        runAllPromises(updateThunks.map(updateThunk => updateThunk())),

        // Update all create thunks in sequence to make sure they're added in the right
        // order.
        (async () => {
            const newMessages: Array<{index: number}> = [];

            for (const createThunk of createThunks) {
                newMessages.push(await createThunk());
            }

            return newMessages;
        })(),
    ]);

    if (
        !isDeepEqual(
            newMessages.map(({index}) => index),
            expectedNewMessageIndexes,
        )
    ) {
        const actualPathname = typeof pathname === "function" ? await pathname() : await pathname;

        throw Object.assign(
            new FailedPreconditionError(
                updateAgentWebMessagingPageUnexpectedNewMessageIndexesErrorMessage,
                {
                    displayMessage: errorDisplayMessage`Update was successful, ${newMessages.length === 1 ? `the ${messageNouns.noun} you added was` : `the ${messageNouns.pluralNoun} you added were`} created. But between the last ${messageNouns.noun} you read${lastMessageIndex > 0 ? ` (\`<${messageNouns.noun} id="${lastMessageIndex - 1}">\`)` : ""} and the ${newMessages.length === 1 ? messageNouns.noun : messageNouns.pluralNoun} you created there are some new ${messageNouns.pluralNoun} from others you haven\u2019t seen. These new ${messageNouns.pluralNoun} may not be relevant to you, but if you want to see them anyway you can call the \`read\` tool with \`${actualPathname}${lastMessageIndex > 0 ? `?after=${lastMessageIndex}` : "?start"}\`.`,
                },
            ),
            // This error is caught by `createAgentWebChatPage()` which wants to change the
            // display message to something more semantically relevant. Include `newMessages`
            // so `createAgentWebChatPage()` has the same information we do when constructing
            // this error.
            {newMessages},
        );
    }

    return {
        messages: [...actualOldPageMetadata.messages, ...newMessages],
    };
}
