import {Root} from "mdast";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {AgentWebPageMetadata} from "~/server/agents/web/agent_web_page.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.js";
import {quoteMarkdown} from "~/server/agents/web/internal/quote_markdown.js";
import {
    parseAgentWebDocumentPage,
    updateAgentWebDocumentPage,
} from "~/server/agents/web/pages/agent_web_document_page.js";
import {parseMarkdownTree} from "~/shared/api/markdown/parse_api_content_from_markdown.js";
import {getErrorDisplayMessage} from "~/shared/error/default_error_display_message.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
    getErrorCode,
} from "~/shared/error/error.js";
import {
    concatErrorDisplayMessages,
    errorDisplayMessage,
} from "~/shared/error/error_display_message.js";
import {getErrorConstructorForCode} from "~/shared/error/get_error_constructor_for_code.js";
import {Mutex} from "~/shared/helpers/async/mutex.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";

export async function callAgentWebUpdateTool(
    context: AgentWebContext,
    {
        path: originalPath,
        updates,
    }: {
        path: string;
        updates: ReadonlyArray<{
            old: string;
            new: string;
            replaceAll: boolean;
        }>;
    },
) {
    assert(updates.length > 0);

    const {path} = normalizeAgentWebPath(originalPath);

    await getOrSetDefaultMapValue(
        context.storage.readResponseMutexByPath,
        path,
        () => new Mutex(),
    ).withLock(async () => {
        const readResponse = await context.storage.readResponseByPath.get(path);

        if (!readResponse || readResponse.expirationTime.getTime() < Date.now()) {
            throw new NotFoundError("Read response not found or expired", {
                displayMessage: errorDisplayMessage`Can\u2019t call the \`update\` tool for a path that hasn\u2019t been read recently. Call the \`read\` tool with the path \`${originalPath}\` then call the \`update\` tool again.`,
            });
        }

        const encoder = new TextEncoder();
        let newResponseBytes = readResponse.responseBytes;
        let newNewlineByteIndexes: Array<number>;

        for (const {old: oldString, new: newString, replaceAll} of updates) {
            if (newString === oldString) {
                const quotedString = quoteMarkdown([{type: "text", value: oldString}]);

                throw new InvalidArgumentError("New string and old string are the same", {
                    displayMessage: errorDisplayMessage`The \`old\` string and the \`new\` string must be different. Instead they\u2019re both ${quotedString}.`,
                });
            }

            if (oldString.length === 0) {
                throw new InvalidArgumentError("Old string is empty", {
                    displayMessage: errorDisplayMessage`The \`old\` string is empty. You must search for some string in the path \`${originalPath}\`.`,
                });
            }

            const oldBytes = encoder.encode(oldString);
            const newBytes = encoder.encode(newString);
            const byteDifference = newBytes.length - oldBytes.length;

            const oldResponseBytes = newResponseBytes;

            const newResponseBuffer = new ArrayBuffer(oldResponseBytes.length + byteDifference, {
                maxByteLength: replaceAll
                    ? // The `maxByteLength` assumes `oldResponseBytes` is filled with instances of
                      // `oldBytes`. For example, `oldBytes` is "ab" and `oldResponseBytes` is
                      // "abababababababab...".
                      oldResponseBytes.length +
                      byteDifference * Math.floor(oldResponseBytes.length / oldBytes.length)
                    : undefined,
            });

            newResponseBytes = new Uint8Array(newResponseBuffer);
            newNewlineByteIndexes = [];

            let oldByteIndex = 0;
            let newByteIndex = 0;
            let matchCount = 0;

            while (oldByteIndex < oldResponseBytes.length) {
                let found = true;

                const oldByte = oldResponseBytes[oldByteIndex]!;

                if (oldByte !== oldBytes[0]) {
                    found = false;
                } else {
                    const oldBytesLength = oldBytes.length;

                    for (let oldByteIndex2 = 1; oldByteIndex2 < oldBytesLength; oldByteIndex2++) {
                        if (
                            oldResponseBytes[oldByteIndex + oldByteIndex2] !==
                            oldBytes[oldByteIndex2]
                        ) {
                            found = false;
                            break;
                        }
                    }
                }

                // No match found. Copy the existing byte over and carry on.
                if (!found) {
                    newResponseBytes[newByteIndex] = oldByte;
                    if (oldByte === 10) newNewlineByteIndexes.push(newByteIndex);
                    oldByteIndex++;
                    newByteIndex++;
                    continue;
                }

                matchCount++;

                if (!replaceAll && matchCount > 1) {
                    const quotedString = quoteMarkdown([{type: "text", value: oldString}]);

                    throw new FailedPreconditionError("Found multiple matches for the old string", {
                        // We intentionally don't mention the `replaceAll` option in this error message.
                        // Most of the time the agent's intent is to update exactly one thing. We don't
                        // want the agent to take the lazy path of setting `replaceAll: true` and
                        // potentially ovewrite content it didn't intend to overwrite.
                        //
                        // This error message was [derived from OpenCode][1].
                        //
                        // [1]:
                        //     https://github.com/anomalyco/opencode/blob/4961d72c0fa23ee23bca9ea59b86a2b13bcf4427/packages/opencode/src/tool/edit.ts#L665
                        displayMessage: errorDisplayMessage`Multiple matches were found for the \`old\` string ${quotedString}. Provide more surrounding context to make the match unique.`,
                    });
                }

                // If the buffer is too small for this additional match, then resize the buffer
                // assuming 2x the current `matchCount`. We take this 2x heuristic from the
                // [Rustonomicon's article on allocating memory for a naive `Vec`
                // implementation][1].
                //
                // [1]: https://doc.rust-lang.org/nomicon/vec/vec-alloc.html
                if (
                    replaceAll &&
                    oldResponseBytes.length + byteDifference * matchCount >
                        newResponseBuffer.byteLength
                ) {
                    newResponseBuffer.resize(
                        Math.min(
                            oldResponseBytes.length + byteDifference * matchCount * 2,
                            newResponseBuffer.maxByteLength,
                        ),
                    );
                }

                const newBytesLength = newBytes.length;

                // Actually perform the replace!
                for (
                    let newByteIndex2 = 0;
                    newByteIndex2 < newBytesLength;
                    newByteIndex2++, newByteIndex++
                ) {
                    const newByte = newBytes[newByteIndex2]!;
                    newResponseBytes[newByteIndex] = newByte;
                    if (newByte === 10) newNewlineByteIndexes.push(newByteIndex);
                }

                oldByteIndex += oldBytes.length;
            }

            if (matchCount === 0) {
                const quotedString = quoteMarkdown([{type: "text", value: oldString}]);

                // Error message [derived from OpenCode][1].
                //
                // [1]:
                //     https://github.com/anomalyco/opencode/blob/4961d72c0fa23ee23bca9ea59b86a2b13bcf4427/packages/opencode/src/tool/edit.ts#L661-L663
                throw new FailedPreconditionError("Couldn\u2019t find a match for the old string", {
                    displayMessage: errorDisplayMessage`Couldn\u2019t find the \`old\` string ${quotedString}. Try again. The \`old\` string must exactly match existing content, including whitespace, indentation, and line endings.`,
                });
            }

            // Resize the buffer to its final size based on the number of matches found.
            if (replaceAll)
                newResponseBuffer.resize(oldResponseBytes.length + byteDifference * matchCount);

            // There's implicitly a newline at the end of the response. This also means
            // `newlineByteIndexes` is non-empty.
            newNewlineByteIndexes.push(newResponseBytes.length);
        }

        const decoder = new TextDecoder();

        // Not all updates are going to be atomic. If we make an update that's not atomic
        // and it fails then we need to know if part of the update succeeded. If part of
        // the update succeeded then we need to delete our entry from `readResponseByPath`
        // since it's invalid. The agent will need to re-read the path.
        //
        // TODO(calebmer, #agent-web): Once we have an update that might have a partial
        // success then write a test to make sure in the partial success case we clean
        // `readResponseByPath`!
        let isPartialSuccess = false;

        const contextWithPartialSuccessDetection: AgentWebContext = {
            ...context,
            api: {
                get: context.api.get.bind(context.api),
                put: async (...args: any): Promise<any> => {
                    // eslint-disable-next-line prefer-spread
                    const value = await context.api.put.apply(context.api, args);
                    isPartialSuccess = true;
                    return value;
                },
                post: async (...args: any): Promise<any> => {
                    // eslint-disable-next-line prefer-spread
                    const value = await context.api.post.apply(context.api, args);
                    isPartialSuccess = true;
                    return value;
                },
                delete: async (...args: any): Promise<any> => {
                    // eslint-disable-next-line prefer-spread
                    const value = await context.api.delete.apply(context.api, args);
                    isPartialSuccess = true;
                    return value;
                },
                patch: async (...args: any): Promise<any> => {
                    // eslint-disable-next-line prefer-spread
                    const value = await context.api.patch.apply(context.api, args);
                    isPartialSuccess = true;
                    return value;
                },
            },
        };

        let newPageMetadata: AgentWebPageMetadata;

        try {
            newPageMetadata = await updateAgentWebPageLink(
                contextWithPartialSuccessDetection,
                readResponse.pageMetadata,
                new Lazy(() => {
                    const oldResponseString = decoder.decode(readResponse.responseBytes);
                    return parseMarkdownTree(oldResponseString);
                }),
                (() => {
                    const newResponseString = decoder.decode(newResponseBytes);
                    return parseMarkdownTree(newResponseString);
                })(),
            );
        } catch (error) {
            if (!isPartialSuccess) throw error;

            // Delete the read response since we don't know which parts of the update were
            // successful and which parts failed!
            await context.storage.readResponseByPath.delete(path);

            const errorCode = getErrorCode(error);
            const ErrorConstructor = getErrorConstructorForCode(errorCode);
            const displayMessage = getErrorDisplayMessage(error);

            // Modify the `displayMessage` so the agent knows the update was a partial success
            // and that it needs to call `read` again since just trying `update` again won't
            // work because we deleted the entry from `readResponseByPath`.
            throw new ErrorConstructor(
                (error instanceof Error ? error.message : String(error)) +
                    " (PARTIAL SUCCESS: some of this update was persisted)",
                {
                    cause: error,
                    displayMessage: concatErrorDisplayMessages(
                        displayMessage,
                        errorDisplayMessage` (This update was a partial success. You must call the \`read\` tool again for \`${originalPath}\` to find out which parts of the update were successful.)`,
                    ),
                },
            );
        }

        // Allow future `read_more` calls and future `update` calls to operate on the
        // updated response we just wrote to the database.
        await context.storage.readResponseByPath.put(path, {
            expirationTime: readResponse.expirationTime,
            pageMetadata: newPageMetadata,
            responseBytes: newResponseBytes,
            newlineByteIndexes: newNewlineByteIndexes!,
        });
    });
}

async function updateAgentWebPageLink(
    context: AgentWebContext,
    oldPageMetadata: AgentWebPageMetadata,
    // Lazily compute the `oldResponse` since sometimes we don't need it.
    oldResponse: Lazy<Root>,
    newResponse: Root,
): Promise<AgentWebPageMetadata> {
    switch (oldPageMetadata.type) {
        case "Document": {
            const newPage = await parseAgentWebDocumentPage(
                context.storage,
                oldPageMetadata.id,
                newResponse,
            );

            return updateAgentWebDocumentPage(context, oldPageMetadata, newPage);
        }
        default:
            throw exhaustive(oldPageMetadata);
    }
}
