import {Root} from "mdast";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.js";
import {AgentWebPageMetadata} from "~/server/agents/web/agent_web_page.js";
import {formatAgentWebMarkdown} from "~/server/agents/web/format_agent_web_markdown.js";
import {curlyQuote} from "~/server/agents/web/internal/curly_quote.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.js";
import {
    parseAgentWebAccountPage,
    updateAgentWebAccountPage,
} from "~/server/agents/web/pages/agent_web_account_page.js";
import {
    parseAgentWebChannelPage,
    updateAgentWebChannelPage,
} from "~/server/agents/web/pages/agent_web_channel_page.js";
import {
    parseAgentWebChatPage,
    updateAgentWebChatPage,
} from "~/server/agents/web/pages/agent_web_chat_page.js";
import {
    parseAgentWebDocumentPage,
    updateAgentWebDocumentPage,
} from "~/server/agents/web/pages/agent_web_document_page.js";
import {
    parseAgentWebDocumentThreadPage,
    updateAgentWebDocumentThreadPage,
} from "~/server/agents/web/pages/agent_web_document_thread_page.js";
import {
    parseAgentWebPostPage,
    updateAgentWebPostPage,
} from "~/server/agents/web/pages/agent_web_post_page.js";
import {
    parseAgentWebTaskCollectionPage,
    updateAgentWebTaskCollectionPage,
} from "~/server/agents/web/pages/agent_web_task_collection_page.js";
import {
    parseAgentWebTaskMessageListPage,
    updateAgentWebTaskMessageListPage,
} from "~/server/agents/web/pages/agent_web_task_message_list_page.js";
import {
    parseAgentWebTaskPage,
    updateAgentWebTaskPage,
} from "~/server/agents/web/pages/agent_web_task_page.js";
import {
    parseAgentWebTaskSubtasksPage,
    updateAgentWebTaskSubtasksPage,
} from "~/server/agents/web/pages/agent_web_task_subtasks_page.js";
import {printAgentWebError} from "~/server/agents/web/print_agent_web_error.js";
import {parseMarkdownTree} from "~/shared/api/content/parse_api_content_from_markdown.js";
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
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.js";
import {quote} from "~/shared/helpers/string/quote.js";

export async function callAgentWebUpdateTool(
    context: AgentWebContext,
    options: {
        path: string;
        updates: ReadonlyArray<{
            old: string;
            new: string;
            replaceAll: boolean;
        }>;
    },
): Promise<string> {
    return await context.span.withSpan("Call agent web update tool", async span => {
        try {
            return await actuallyCallAgentWebUpdateTool({...context, span}, options);
        } catch (error) {
            span.addException(error);

            return await printAgentWebError(`Couldn\u2019t update ${quote(options.path)}`, error);
        }
    });
}

async function actuallyCallAgentWebUpdateTool(
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
): Promise<string> {
    assert(updates.length > 0);

    const {path, pathname} = normalizeAgentWebPath(originalPath);

    await getOrSetDefaultMapValue(
        context.storage.readResponseMutexByPath,
        path,
        () => new Mutex(),
    ).withLock(async () => {
        const readResponse = await context.storage.readResponseByPath.get(path);

        if (!readResponse || readResponse.expirationTime.getTime() < Date.now()) {
            throw new NotFoundError("Read response not found or expired", {
                displayMessage: errorDisplayMessage`Can\u2019t call the \`update\` tool for a path that hasn\u2019t been read recently. Call the \`read\` tool with the path ${quote(originalPath)} then call the \`update\` tool again.`,
            });
        }

        let newResponse = readResponse.response;
        let newNewlineIndexes: Array<number>;

        for (const {old: oldString, new: newString, replaceAll} of updates) {
            if (newString === oldString) {
                const quotedString = curlyQuote(oldString);

                throw new InvalidArgumentError("New string and old string are the same", {
                    displayMessage: errorDisplayMessage`The \`old\` string and the \`new\` string must be different. Instead they\u2019re both ${quotedString}.`,
                });
            }

            if (oldString.length === 0) {
                throw new InvalidArgumentError("Old string is empty", {
                    displayMessage: errorDisplayMessage`The \`old\` string is empty. You must search for some string in the path ${quote(originalPath)}.`,
                });
            }

            const oldResponse = newResponse;
            const matchIndexes: Array<number> = [];
            let lastMatchIndex: number | null = null;

            while (true) {
                const matchIndex = oldResponse.indexOf(
                    oldString,
                    lastMatchIndex !== null ? lastMatchIndex + 1 : 0,
                );

                if (matchIndex === -1) break;

                matchIndexes.push(matchIndex);
                lastMatchIndex = matchIndex;
            }

            if (matchIndexes.length === 0) {
                const quotedString = curlyQuote(oldString);

                // Error message [derived from OpenCode][1].
                //
                // [1]:
                //     https://github.com/anomalyco/opencode/blob/4961d72c0fa23ee23bca9ea59b86a2b13bcf4427/packages/opencode/src/tool/edit.ts#L661-L663
                throw new FailedPreconditionError("Couldn\u2019t find a match for the old string", {
                    displayMessage: errorDisplayMessage`Couldn\u2019t find the \`old\` string ${quotedString}. Try again. The \`old\` string must exactly match existing content, including whitespace, indentation, and line endings.`,
                });
            }

            if (!replaceAll && matchIndexes.length > 1) {
                const quotedString = curlyQuote(oldString);

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

            let lastOldIndex = 0;
            newResponse = "";

            for (const matchIndex of matchIndexes) {
                newResponse += oldResponse.slice(lastOldIndex, matchIndex);
                newResponse += newString;
                lastOldIndex = matchIndex + oldString.length;
            }

            newResponse += oldResponse.slice(lastOldIndex);

            // Find all the newline indexes in our response. So the `scroll` tool can easily
            // return a slice of the response.
            newNewlineIndexes = [];

            for (let index = 0; index < newResponse.length; index++) {
                if (newResponse[index] === "\n") {
                    newNewlineIndexes.push(index);
                }
            }

            // There's implicitly a newline at the end of the response. This also means
            // `newlineIndexes` is non-empty.
            newNewlineIndexes.push(newResponse.length);
        }

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
                pathname,
                readResponse.pageMetadata,
                new Lazy(() => parseMarkdownTree(readResponse.response)),
                (() => parseMarkdownTree(newResponse))(),
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
                        errorDisplayMessage` (This update was a partial success. You must call the \`read\` tool again for ${quote(originalPath)} to find out which parts of the update were successful.)`,
                    ),
                },
            );
        }

        // Allow future `scroll` calls and future `update` calls to operate on the updated
        // response we just wrote to the database.
        await context.storage.readResponseByPath.put(path, {
            expirationTime: readResponse.expirationTime,
            pageMetadata: newPageMetadata,
            response: newResponse,
            newlineIndexes: newNewlineIndexes!,
        });
    });

    const markdown = "Update was successful.";

    return await formatAgentWebMarkdown(markdown);
}

async function updateAgentWebPageLink(
    context: AgentWebContext,
    pathname: string,
    oldPageMetadata: AgentWebPageMetadata,
    // Lazily compute the `oldResponse` since sometimes we don't need it.
    oldResponseLazy: Lazy<Root>,
    newResponse: Root,
): Promise<AgentWebPageMetadata> {
    switch (oldPageMetadata.type) {
        case "Account": {
            const oldResponse = oldResponseLazy.get();

            const [oldPage, newPage] = await runAllPromises([
                parseAgentWebAccountPage(context.storage, oldPageMetadata.id, oldResponse),
                parseAgentWebAccountPage(context.storage, oldPageMetadata.id, newResponse),
            ]);

            return updateAgentWebAccountPage(context, oldPageMetadata, oldPage, newPage);
        }
        case "Document": {
            const newPage = await parseAgentWebDocumentPage(
                context.storage,
                oldPageMetadata.id,
                newResponse,
            );

            return await updateAgentWebDocumentPage(context, oldPageMetadata, newPage);
        }
        case "DocumentThread": {
            const oldResponse = oldResponseLazy.get();

            const [oldPage, newPage] = await runAllPromises([
                parseAgentWebDocumentThreadPage(
                    context.storage,
                    {document: {id: oldPageMetadata.id}, threadId: oldPageMetadata.threadId},
                    oldResponse,
                ),
                parseAgentWebDocumentThreadPage(
                    context.storage,
                    {document: {id: oldPageMetadata.id}, threadId: oldPageMetadata.threadId},
                    newResponse,
                ),
            ]);

            return await updateAgentWebDocumentThreadPage(
                context,
                pathname,
                oldPageMetadata,
                oldPage,
                newPage,
            );
        }
        case "Channel": {
            const oldResponse = oldResponseLazy.get();

            const [oldPage, newPage] = await runAllPromises([
                parseAgentWebChannelPage(context.storage, oldPageMetadata.id, oldResponse),
                parseAgentWebChannelPage(context.storage, oldPageMetadata.id, newResponse),
            ]);

            return await updateAgentWebChannelPage(context, oldPageMetadata, oldPage, newPage);
        }
        case "Chat": {
            const oldResponse = oldResponseLazy.get();

            const [oldPage, newPage] = await runAllPromises([
                parseAgentWebChatPage(context.storage, oldPageMetadata.id, oldResponse),
                parseAgentWebChatPage(context.storage, oldPageMetadata.id, newResponse),
            ]);

            return await updateAgentWebChatPage(
                context,
                pathname,
                oldPageMetadata,
                oldPage,
                newPage,
            );
        }
        case "TaskMessageList": {
            const oldResponse = oldResponseLazy.get();

            const [oldPage, newPage] = await runAllPromises([
                parseAgentWebTaskMessageListPage(context.storage, oldPageMetadata.id, oldResponse),
                parseAgentWebTaskMessageListPage(context.storage, oldPageMetadata.id, newResponse),
            ]);

            return await updateAgentWebTaskMessageListPage(
                context,
                pathname,
                oldPageMetadata,
                oldPage,
                newPage,
            );
        }
        case "Task": {
            const oldResponse = oldResponseLazy.get();

            const [oldPage, newPage] = await runAllPromises([
                parseAgentWebTaskPage(context.storage, oldPageMetadata.id, oldResponse),
                parseAgentWebTaskPage(context.storage, oldPageMetadata.id, newResponse),
            ]);

            return await updateAgentWebTaskPage(context, oldPageMetadata, oldPage, newPage);
        }
        case "TaskCollection": {
            const oldResponse = oldResponseLazy.get();

            const [oldPage, newPage] = await runAllPromises([
                parseAgentWebTaskCollectionPage(context.storage, oldPageMetadata.id, oldResponse),
                parseAgentWebTaskCollectionPage(context.storage, oldPageMetadata.id, newResponse),
            ]);

            return await updateAgentWebTaskCollectionPage(
                context,
                oldPageMetadata,
                oldPage,
                newPage,
            );
        }
        case "TaskSubtasks": {
            const oldResponse = oldResponseLazy.get();

            const [oldPage, newPage] = await runAllPromises([
                parseAgentWebTaskSubtasksPage(context.storage, oldPageMetadata.id, oldResponse),
                parseAgentWebTaskSubtasksPage(context.storage, oldPageMetadata.id, newResponse),
            ]);

            return await updateAgentWebTaskSubtasksPage(context, oldPageMetadata, oldPage, newPage);
        }
        case "Post": {
            const oldResponse = oldResponseLazy.get();

            const [oldPage, newPage] = await runAllPromises([
                parseAgentWebPostPage(context.storage, oldPageMetadata.id, oldResponse),
                parseAgentWebPostPage(context.storage, oldPageMetadata.id, newResponse),
            ]);

            return await updateAgentWebPostPage(
                context,
                pathname,
                oldPageMetadata,
                oldPage,
                newPage,
            );
        }
        default:
            throw exhaustive(oldPageMetadata);
    }
}
