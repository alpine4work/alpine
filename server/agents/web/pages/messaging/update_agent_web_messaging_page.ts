import escapeHtml from "escape-html";
import {Link} from "mdast";
import {createApiMessage} from "~/server/agents/api/api_client.js";
import {AgentWebContextWithoutStorage} from "~/server/agents/web/agent_web_context.js";
import {
    AgentWebMessagingPage,
    AgentWebMessagingPageBlock,
    AgentWebMessagingPageCustomBlockBase,
    AgentWebMessagingPageMessageRange,
    AgentWebMessagingPageMetadata,
    AgentWebMessagingPageMetadataMessage,
    AgentWebMessagingPageNouns,
    AgentWebMessagingPagePagination,
} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {printAgentWebMessagingPageMessageIndexRange} from "~/server/agents/web/pages/messaging/print_agent_web_messaging_page.js";
import {findApiContentRanges} from "~/shared/api/content/find_api_content_ranges.js";
import {
    normalizeApiContent,
    normalizeApiReference,
} from "~/shared/api/content/normalize_api_content.js";
import {printMarkdownTree} from "~/shared/api/content/print_api_content_to_markdown.js";
import {
    parseTemporaryApiContentKey,
    unsafelyZipTemporaryKeysIntoApiContentResponse,
    unzipKeysFromApiContentResponse,
} from "~/shared/api/content/zip_or_unzip_keys_from_api_content_response.js";
import {ApiContentKey} from "~/shared/api/specification/types/api_content_key.js";
import {ApiContentRange} from "~/shared/api/specification/types/api_content_position.js";
import {ApiMessageRoomReference} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {
    FailedPreconditionError,
    InternalError,
    InvalidArgumentError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {unwrapMaybeThunk} from "~/shared/helpers/control/unwrap_maybe_thunk.js";
import {areRangesOverlapping} from "~/shared/helpers/geometry/are_ranges_overlapping.js";
import {reverseIterable} from "~/shared/helpers/iterable/reverse_iterable.js";
import {omitObject} from "~/shared/helpers/object/omit_object.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.js";

export const updateAgentWebMessagingPageUnexpectedNewMessageIndexesErrorMessage =
    "Update was successful, but the agent needs to know there were some other messages added it hasn\u2019t observed";

export async function updateAgentWebMessagingPage<
    Preamble,
    CustomBlock extends AgentWebMessagingPageCustomBlockBase,
>(
    context: AgentWebContextWithoutStorage,
    {
        messageNouns,
        pathname,
        room,
        oldPageMetadata,
        oldPage,
        newPage,
        prepareCustomBlockUpdate,
    }: {
        messageNouns: AgentWebMessagingPageNouns;
        // Will only run the thunk in the error cases which need to display the `pathname`.
        pathname: MaybeThunk<MaybePromise<string>>;
        // Will only run the thunk right before messages are created. Validation always
        // runs before we call this thunk.
        room: MaybeThunk<MaybePromise<ApiMessageRoomReference>>;
        // Will only run the thunk right before messages are created. Validation always
        // runs before we call this thunk.
        oldPageMetadata: MaybeThunk<MaybePromise<AgentWebMessagingPageMetadata>>;
        oldPage: AgentWebMessagingPage<Preamble, CustomBlock>;
        newPage: AgentWebMessagingPage<Preamble, CustomBlock>;
        prepareCustomBlockUpdate: (
            oldCustomBlock: CustomBlock,
            newCustomBlock: CustomBlock,
        ) => {update: () => Promise<void>};
    },
): Promise<AgentWebMessagingPageMetadata> {
    const updateThunks: Array<() => Promise<AgentWebMessagingPageMetadataMessage | null>> = [];
    const createThunks: Array<
        (
            newPageMetadata: AgentWebMessagingPageMetadata,
        ) => Promise<AgentWebMessagingPageMetadataMessage>
    > = [];

    // Strip response properties from the preamble before comparing for equality. We
    // don't care if `pageLink.title`s aren't equal. The `title` might have changed
    // between the old page load time and new page generation time.
    const normalizePagination = (
        pagination: AgentWebMessagingPagePagination<CustomBlock> | null,
    ) => {
        if (!pagination) return null;

        return {
            ...pagination,
            pageLink: (() => {
                switch (pagination.pageLink.type) {
                    case "DocumentThread": {
                        return {
                            type: "DocumentThread",
                            document: normalizeApiReference(pagination.pageLink.document),
                            threadId: pagination.pageLink.threadId,
                        };
                    }
                    case "TaskMessageList": {
                        return {
                            ...pagination.pageLink,
                            task: normalizeApiReference(pagination.pageLink.task),
                        };
                    }
                    default:
                        return normalizeApiReference(pagination.pageLink);
                }
            })(),
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

    const newPagePaginationPreviousLinkBeforeMessageIndex =
        newPage.pagination?.previousLink?.type === "Message"
            ? newPage.pagination.previousLink.beforeMessageIndex
            : 0;

    let fallbackMessageIndex = newPagePaginationPreviousLinkBeforeMessageIndex;
    const resolvedIdAttributes: Array<AgentWebMessagingPageMessageRange | null> = [];

    for (let index = 0; index < commonBlocksLength; index++) {
        const oldBlock = oldPage.blocks[index]!;
        const newBlock = newPage.blocks[index]!;

        if (newBlock.type !== "Message") {
            resolvedIdAttributes.push(null);
        } else {
            let idAttribute: AgentWebMessagingPageMessageRange;

            if (newBlock.idAttribute) {
                idAttribute = newBlock.idAttribute;
            } else {
                idAttribute = {
                    startMessageIndex: fallbackMessageIndex,
                    endMessageIndex: fallbackMessageIndex + 1,
                };
            }

            fallbackMessageIndex = idAttribute.endMessageIndex;
            resolvedIdAttributes.push(idAttribute);
        }

        if (oldBlock.type === "Custom" || newBlock.type === "Custom") {
            if (oldBlock.type === "Custom" && newBlock.type === "Custom") {
                const {update} = prepareCustomBlockUpdate(oldBlock, newBlock);

                updateThunks.push(async () => {
                    await update();
                    return null;
                });
                continue;
            }

            const oldTagName =
                oldBlock.type === "Message"
                    ? messageNouns.noun
                    : oldBlock.type === "Time"
                      ? "time"
                      : oldBlock.tagName;

            const newTagName =
                newBlock.type === "Message"
                    ? messageNouns.noun
                    : newBlock.type === "Time"
                      ? "time"
                      : newBlock.tagName;

            throw new InvalidArgumentError(
                "Can\u2019t convert between custom blocks and other blocks",
                {
                    displayMessage: errorDisplayMessage`You can\u2019t turn \`<${oldTagName}>\`s into \`<${newTagName}>\`s. Try again with a more specific update that only changes the content of ${messageNouns.pluralNoun} from you or adds new ${messageNouns.pluralNoun}.`,
                },
            );
        }

        // Strip response properties from the block before comparing for equality. We don't
        // care if `reference.title`s aren't equal. The `title` might have changed between
        // the old page load time and new page generation time.
        const normalizeBlock = (block: AgentWebMessagingPageBlock<never>) => {
            if (block.type === "Time") return block;

            return {
                type: "Message",
                idAttribute: block.idAttribute,
                author: {id: block.author?.id ?? context.botAccount.id},
                timeAttribute: block.timeAttribute,
                timeZoneAttribute: block.timeZoneAttribute,
                parent: block.parent
                    ? {
                          citeAttribute: block.parent.citeAttribute,
                          matchAttribute: block.parent.matchAttribute,
                          author: normalizeApiReference(block.parent.author),
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
                            displayMessage: errorDisplayMessage`You can only update your \`<${messageNouns.noun}>\`s. You can\u2019t update a \`<${messageNouns.noun}>\` created by ${oldBlock.author?.shortName ?? context.botAccount.shortName}. \`<${messageNouns.noun}${normalizedOldBlock.idAttribute ? ` id="${printAgentWebMessagingPageMessageIndexRange(normalizedOldBlock.idAttribute)}"` : ""} from="${escapeHtml(oldBlock.author?.shortName ?? context.botAccount.shortName)}">\` was changed by this update. Try again with a more specific update that only changes the content of ${messageNouns.pluralNoun} from you or adds new ${messageNouns.pluralNoun}.`,
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

        const idAttribute = assertExists(resolvedIdAttributes[index]);

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
                // TODO(#agents-web): Implement message update endpoint and return the updated
                // message's unzipped content keys.
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

    lastMessageIndex ??= newPagePaginationPreviousLinkBeforeMessageIndex + nullIdAttributeCount;

    const expectedNewMessageIndexes: Array<number> = [];

    for (let index = commonBlocksLength; index < newPage.blocks.length; index++) {
        const newBlock = newPage.blocks[index]!;

        // NOCOMMIT: Test!
        if (newBlock.type !== "Message") {
            if (newBlock.type === "Time") {
                throw new InvalidArgumentError("Can only create messages (not `<time>`)", {
                    displayMessage: errorDisplayMessage`Unexpected \`<time>\`, you can only add \`<${messageNouns.noun}>\`s. The creation time of ${messageNouns.pluralNoun} will be decided by the server. Try again and remove the new \`<time>\`.`,
                });
            } else {
                throw new InvalidArgumentError("Can only create messages", {
                    displayMessage: errorDisplayMessage`Unexpected \`<${newBlock.tagName}>\`, you can only add \`<${messageNouns.noun}>\`s. Try again and remove the new \`<${newBlock.tagName}>\`.`,
                });
            }
        }

        if (newBlock.author !== null && newBlock.author.id !== context.botAccount.id) {
            const authorLink: Link = {
                type: "link",
                url: context.botAccount.pathname,
                children: [{type: "text", value: context.botAccount.shortName}],
            };

            throw new InvalidArgumentError("Can only create messages as own account", {
                displayMessage: errorDisplayMessage`You can only add a \`<${messageNouns.noun}>\` from yourself. Try again with a \`from\` attribute that references yourself (\`from="${escapeHtml(printMarkdownTree(authorLink).trim())}"\`).`,
            });
        }

        const expectedNewMessageIndex = lastMessageIndex + (index - commonBlocksLength);
        expectedNewMessageIndexes.push(expectedNewMessageIndex);

        if (
            newBlock.idAttribute &&
            (newBlock.idAttribute.startMessageIndex !== expectedNewMessageIndex ||
                newBlock.idAttribute.endMessageIndex !== expectedNewMessageIndex + 1)
        ) {
            throw new InvalidArgumentError(
                "Can\u2019t create message with incorrect `id` attribute",
                {
                    displayMessage: errorDisplayMessage`Invalid \`id\` attribute for new \`<${messageNouns.noun}>\`. The \`<${messageNouns.noun}>\` \`id\` attribute is an integer sequence so the next valid \`id\` is \`${lastMessageIndex + (index - commonBlocksLength)}\`. Try again with \`id="${lastMessageIndex + (index - commonBlocksLength)}"\`.`,
                },
            );
        }

        const idAttribute = newBlock.idAttribute ?? {
            startMessageIndex: expectedNewMessageIndex,
            endMessageIndex: expectedNewMessageIndex + 1,
        };

        resolvedIdAttributes.push(idAttribute);

        if (newBlock.timeAttribute) {
            throw new InvalidArgumentError("Can\u2019t set the created time of a new message", {
                displayMessage: errorDisplayMessage`You can\u2019t add a \`<${messageNouns.noun}>\` with a \`time\` attribute. The creation time of the ${messageNouns.noun} will be decided by the server. Try again without the \`time\` attribute.`,
            });
        }

        let newBlockParentRange: {
            messageRange: AgentWebMessagingPageMessageRange;
            contentRange: ApiContentRange;
        } | null = null;

        // If this new message has a `<blockquote>` parent, then find the corresponding
        // text in our message page. We use temporary `ApiContentKey`s which we can convert
        // into proper `ApiContentKey`s in `createThunk`.
        if (newBlock.parent) {
            let citedBlock: {
                block: Extract<AgentWebMessagingPageBlock<never>, {type: "Message"}>;
                idAttribute: AgentWebMessagingPageMessageRange;
            } | null = null;

            for (let otherIndex = 0; otherIndex < index; otherIndex++) {
                const otherNewBlock = newPage.blocks[otherIndex]!;
                if (otherNewBlock.type !== "Message") continue;

                const otherIdAttribute = assertExists(resolvedIdAttributes[otherIndex]);

                if (
                    otherIdAttribute.startMessageIndex ===
                        newBlock.parent.citeAttribute.startMessageIndex &&
                    otherIdAttribute.endMessageIndex ===
                        newBlock.parent.citeAttribute.endMessageIndex
                ) {
                    citedBlock = {block: otherNewBlock, idAttribute: otherIdAttribute};
                    break;
                }

                if (
                    areRangesOverlapping(
                        otherIdAttribute.startMessageIndex,
                        otherIdAttribute.endMessageIndex - 1,
                        newBlock.parent.citeAttribute.startMessageIndex,
                        newBlock.parent.citeAttribute.endMessageIndex - 1,
                    )
                ) {
                    const otherIdAttributeString =
                        printAgentWebMessagingPageMessageIndexRange(otherIdAttribute);

                    const parentCiteAttributeString = printAgentWebMessagingPageMessageIndexRange(
                        newBlock.parent.citeAttribute,
                    );

                    throw new InvalidArgumentError(
                        "`<blockquote>` `cite` attribute overlaps with a message block `id` but doesn\u2019t exactly equal the message block `id`",
                        {
                            displayMessage: errorDisplayMessage`The \`<blockquote>\` \`cite\` attribute must exactly match a \`<${messageNouns.noun}>\` \`id\` on the current page. \`cite="?${messageNouns.noun}=${parentCiteAttributeString}"\` overlaps with \`<${messageNouns.noun} id="${otherIdAttributeString}">\`, but doesn\u2019t exactly match it. Try again with \`cite="?${messageNouns.noun}=${otherIdAttributeString}"\`.`,
                        },
                    );
                }
            }

            if (citedBlock === null) {
                const parentCiteAttributeString = printAgentWebMessagingPageMessageIndexRange(
                    newBlock.parent.citeAttribute,
                );

                throw new InvalidArgumentError("`<blockquote>` `cite` not found on this page", {
                    displayMessage: errorDisplayMessage`Couldn\u2019t find \`<${messageNouns.noun} id="${parentCiteAttributeString}">\` referenced by \`<blockquote cite="?${messageNouns.noun}=${parentCiteAttributeString}">\` on the current page. To create a ${messageNouns.noun} that replies to another ${messageNouns.noun}, the cited ${messageNouns.noun} must be visible on the current page. If you\u2019re trying to quote a ${messageNouns.noun} that\u2019s not on this page then call the \`read\` tool with a larger \`limit\` so that the ${messageNouns.noun} you\u2019re replying to is on the same page you\u2019re updating. Try again without the \`<blockquote>\`, with a different \`cite\` attribute reference a message on the current page, or after calling \`read\` with a larger limit so the \`<${messageNouns.noun}>\` you\u2019re replying to is on the same page you\u2019re updating.`,
                });
            }

            const citedBlockAuthor = citedBlock.block.author ?? context.botAccount;
            if (citedBlockAuthor.id !== newBlock.parent.author.id) {
                const idAttributeString = printAgentWebMessagingPageMessageIndexRange(
                    citedBlock.idAttribute,
                );

                throw new InvalidArgumentError(
                    "`<blockquote>` author prefix does not match cited message author",
                    {
                        displayMessage: errorDisplayMessage`The \`<blockquote>\` content starts with \`[${newBlock.parent.author.shortName}](...): \`, but \`<${messageNouns.noun} id="${idAttributeString}">\` is from \u201C${citedBlockAuthor.shortName}\u201D. Try again with \`[${citedBlockAuthor.shortName}](...): \` before any other \`<blockquote>\` content.`,
                    },
                );
            }

            // NOCOMMIT: What about deleted messages??
            const {content: otherContent} = unsafelyZipTemporaryKeysIntoApiContentResponse(
                citedBlock.block.content,
            );
            const ranges = Array.from(
                findApiContentRanges(otherContent, newBlock.parent.previewContent),
            );

            // NOCOMMIT: Include a link to a skill with more information about content
            // matching.
            if (ranges.length === 0) {
                throw new InvalidArgumentError("Quoted message content not found", {
                    displayMessage: errorDisplayMessage`Couldn\u2019t find the quoted content in \`<blockquote>\` in the current ${messageNouns.noun} page. To create a ${messageNouns.noun} that replies to another ${messageNouns.noun} you must exactly recreate the content you\u2019re repluing to in \`<blockquote>\` so we can find the corresponding range in the ${messageNouns.pluralNoun} on this page. If you\u2019re trying to quote a message that\u2019s not on this page then call the \`read\` tool with a larger \`limit\` so that the ${messageNouns.noun} you\u2019re replying to is on the same page you need to call the \`update\` tool on to create your ${messageNouns.noun}. Formatting is flexible when matching content so \`**needle**\` will match \`**foo needle bar**\` and \`- needle\` will match \`- foo needle bar\` because \`**needle**\` and \`- needle\` correctly match the word \u201Cneedle\u201D and have the right formatting. Simply \`needle\` without formatting will also match \`**foo needle bar**\` and \`- foo needle bar\` however \`_needle_\` will match neither because it has incorrect formatting. Your content in \`<blockquote>\` must be valid markdown so \`**foo needle\` won\u2019t match \`**foo needle bar**\` because the formatting (\`**\`) is unterminated, either \`**foo needle**\` or \`foo needle\` (without formatting) will match. Try again but make sure to exactly copy the content you want to reply to in the current ${messageNouns.noun} page into a \`<blockquote>\`.`,
                });
            }

            if (
                newBlock.parent.matchAttribute !== null &&
                (newBlock.parent.matchAttribute < 1 ||
                    newBlock.parent.matchAttribute > ranges.length)
            ) {
                if (ranges.length === 1) {
                    throw new InvalidArgumentError("Quoted message content match out of bounds", {
                        displayMessage: errorDisplayMessage`The \`<blockquote>\` \`match\` attribute must be 1 or it can be omitted since there\u2019s only one match, instead it was \`match="${newBlock.parent.matchAttribute}"\`. Try again but omit the \`match\` attribute.`,
                    });
                }

                throw new InvalidArgumentError("Quoted message content match out of bounds", {
                    displayMessage: errorDisplayMessage`The \`<blockquote>\` \`match\` attribute must be between 1 and ${ranges.length}, instead it was \`match="${newBlock.parent.matchAttribute}"\`. Try again with a valid 1-indexed \`match\` attribute.`,
                });
            }

            if (newBlock.parent.matchAttribute === null && ranges.length > 1) {
                const citeAttributeString = printAgentWebMessagingPageMessageIndexRange(
                    newBlock.parent.citeAttribute,
                );

                throw new InvalidArgumentError("Quoted message content found more than once", {
                    displayMessage: errorDisplayMessage`${ranges.length} matches were found for the quoted content in \`<blockquote>\` in \`<${messageNouns.noun} id="${citeAttributeString}">\`. Try again but provide more surrounding context to make your match unique or add a 1-indexed \`match\` attribute to \`<blockquote>\` to choose which match to use (e.g. \`<blockquote match="2">\` uses the second match).`,
                });
            }

            newBlockParentRange = {
                messageRange: citedBlock.idAttribute,
                contentRange: ranges[(newBlock.parent.matchAttribute ?? 1) - 1]!,
            };
        }

        createThunks.push(async newPageMetadata => {
            // If we've found a parent range then we found it with temporary keys. So now that
            // we've actually need to create the message and so have the page metadata with
            // actual keys, convert our temporary keys to actual keys.
            if (newBlockParentRange) {
                const keys: Array<ApiContentKey> = [];

                for (const newMessageMetadata of newPageMetadata.messages) {
                    if (
                        newBlockParentRange.messageRange.startMessageIndex <=
                            newMessageMetadata.index &&
                        newMessageMetadata.index < newBlockParentRange.messageRange.endMessageIndex
                    ) {
                        for (const key of newMessageMetadata.keys) {
                            keys.push(key);
                        }
                    }
                }

                const startKeyIndex = parseTemporaryApiContentKey(
                    newBlockParentRange.contentRange.start.key,
                );
                const endKeyIndex = parseTemporaryApiContentKey(
                    newBlockParentRange.contentRange.end.key,
                );

                const startKey = assertExists(keys[startKeyIndex]);
                const endKey = assertExists(keys[endKeyIndex]);

                const range: ApiContentRange = {
                    start: {...newBlockParentRange.contentRange.start, key: startKey},
                    end: {...newBlockParentRange.contentRange.end, key: endKey},
                };

                // TODO(#agents-web): Implement creating message with parent range.
                throw new UnimplementedError(
                    "Creating message with parent as agent isn\u2019t implemented yet",
                    {
                        cause: {
                            startMessageIndex: newBlockParentRange.messageRange.startMessageIndex,
                            endMessageIndex: newBlockParentRange.messageRange.endMessageIndex,
                            range,
                        },
                    },
                );
            }

            if (newBlock.timeZoneAttribute !== null) {
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

            const keys =
                message.payload.type === "Content"
                    ? unzipKeysFromApiContentResponse(message.payload.content).keys
                    : [];

            return {index: message.index, keys};
        });
    }

    // Call the `room` and `oldPageMetadata` thunks right before actually running
    // mutations. That way all validation gets a chance to run first.
    const [actualRoom, actualOldPageMetadata] = await runAllPromises([
        unwrapMaybeThunk(room),
        unwrapMaybeThunk(oldPageMetadata),
    ]);

    // The end of messages marker is optional for a page that's actually at the end of
    // messages (according to metadata). However, for a page that's not at the end of
    // messages you can't add the end of messages marker!
    if (!actualOldPageMetadata.isEndOfMessages && newPage.isEndOfMessages) {
        throw new InvalidArgumentError(
            "Can\u2019t change whether this page is the end of messages or not",
            {
                displayMessage: errorDisplayMessage`Can\u2019t add the \u201CEnd of ${messageNouns.pluralNoun}\u201D marker in an update. Only a \`read\` tool call can tell you whether you\u2019re at the end of a ${messageNouns.noun} ${messageNouns.noun === "comment" ? "section" : "list"} or not. Try again without adding the \u201CEnd of ${messageNouns.pluralNoun}\u201D marker.`,
            },
        );
    }

    // You can only create messages on the last page. Since the end of messages marker
    // is optional on the last page we check metadata.
    if (createThunks.length > 0 && !actualOldPageMetadata.isEndOfMessages) {
        const actualPathname = await unwrapMaybeThunk(pathname);

        throw new InvalidArgumentError("Can only create messages on the last page", {
            displayMessage: errorDisplayMessage`You can only add a \`<${messageNouns.noun}>\` after all other ${messageNouns.pluralNoun} (${messageNouns.pluralNoun} are in chronological order). Look for \u201CEnd of ${messageNouns.pluralNoun}\u201D to know when you\u2019re at the end of a ${messageNouns.noun} ${messageNouns.noun === "comment" ? "section" : "list"}. Call the \`read\` tool with \`${actualPathname}?end\` to jump to the end of a ${messageNouns.noun} ${messageNouns.noun === "comment" ? "section" : "list"}.`,
        });
    }

    // Finally now that we're done validating the update, actually make all changes!
    let newPageMetadata: AgentWebMessagingPageMetadata = {
        isStartOfMessages: actualOldPageMetadata.isStartOfMessages,
        isEndOfMessages: actualOldPageMetadata.isEndOfMessages || newPage.isEndOfMessages,
        messages: actualOldPageMetadata.messages,
    };

    const updatedMessages = await runAllPromises(updateThunks.map(updateThunk => updateThunk()));

    for (const updatedMessage of updatedMessages) {
        if (updatedMessage === null) continue;

        const updatedMessageMetadataIndex = newPageMetadata.messages.findIndex(
            messageMetadata => messageMetadata.index === updatedMessage.index,
        );
        assert(updatedMessageMetadataIndex !== -1);

        const messages = [...newPageMetadata.messages];
        messages[updatedMessageMetadataIndex] = updatedMessage;

        newPageMetadata = {...newPageMetadata, messages};
    }

    const newMessageIndexes: Array<number> = [];

    for (const createThunk of createThunks) {
        const newMessage = await createThunk(newPageMetadata);

        newMessageIndexes.push(newMessage.index);

        newPageMetadata = {
            ...newPageMetadata,
            messages: [...newPageMetadata.messages, newMessage],
        };
    }

    if (!isDeepEqual(newMessageIndexes, expectedNewMessageIndexes)) {
        const actualPathname = typeof pathname === "function" ? await pathname() : await pathname;

        throw Object.assign(
            new FailedPreconditionError(
                updateAgentWebMessagingPageUnexpectedNewMessageIndexesErrorMessage,
                {
                    displayMessage: errorDisplayMessage`Update was successful, ${newMessageIndexes.length === 1 ? `the ${messageNouns.noun} you added was` : `the ${messageNouns.pluralNoun} you added were`} created. But between the last ${messageNouns.noun} you read${lastMessageIndex > 0 ? ` (\`<${messageNouns.noun} id="${lastMessageIndex - 1}">\`)` : ""} and the ${newMessageIndexes.length === 1 ? messageNouns.noun : messageNouns.pluralNoun} you created there are some new ${messageNouns.pluralNoun} from others you haven\u2019t seen. These new ${messageNouns.pluralNoun} may not be relevant to you, but if you want to see them anyway you can call the \`read\` tool with \`${actualPathname}${lastMessageIndex > 0 ? `?after=${lastMessageIndex}` : "?start"}\`.`,
                },
            ),
            // This error is caught by `createAgentWebChatPage()` which wants to change the
            // display message to something more semantically relevant. Include `newMessages`
            // so `createAgentWebChatPage()` has the same information we do when constructing
            // this error.
            {newMessageIndexes},
        );
    }

    return newPageMetadata;
}
