import {Root} from "mdast";
import {AgentWebContext} from "~/server/agents/web/agent_web_context.open_source.js";
import {AgentWebPageMetadata} from "~/server/agents/web/agent_web_page.open_source.js";
import {curlyQuote} from "~/server/agents/web/internal/curly_quote.open_source.js";
import {normalizeAgentWebPath} from "~/server/agents/web/internal/normalize_agent_web_path.open_source.js";
import {
    parseAgentWebAccountPage,
    updateAgentWebAccountPage,
} from "~/server/agents/web/pages/agent_web_account_page.open_source.js";
import {
    parseAgentWebChannelPage,
    updateAgentWebChannelPage,
} from "~/server/agents/web/pages/agent_web_channel_page.open_source.js";
import {
    parseAgentWebChatPage,
    updateAgentWebChatPage,
} from "~/server/agents/web/pages/agent_web_chat_page.open_source.js";
import {
    parseAgentWebDocumentPage,
    updateAgentWebDocumentPage,
} from "~/server/agents/web/pages/agent_web_document_page.open_source.js";
import {
    parseAgentWebDocumentThreadPage,
    updateAgentWebDocumentThreadPage,
} from "~/server/agents/web/pages/agent_web_document_thread_page.open_source.js";
import {
    parseAgentWebInboxPage,
    updateAgentWebInboxPage,
} from "~/server/agents/web/pages/agent_web_inbox_page.open_source.js";
import {
    parseAgentWebPostPage,
    updateAgentWebPostPage,
} from "~/server/agents/web/pages/agent_web_post_page.open_source.js";
import {
    parseAgentWebTaskCollectionPage,
    updateAgentWebTaskCollectionPage,
} from "~/server/agents/web/pages/agent_web_task_collection_page.open_source.js";
import {
    parseAgentWebTaskMessageListPage,
    updateAgentWebTaskMessageListPage,
} from "~/server/agents/web/pages/agent_web_task_message_list_page.open_source.js";
import {
    parseAgentWebTaskPage,
    updateAgentWebTaskPage,
} from "~/server/agents/web/pages/agent_web_task_page.open_source.js";
import {
    parseAgentWebTaskSubtasksPage,
    updateAgentWebTaskSubtasksPage,
} from "~/server/agents/web/pages/agent_web_task_subtasks_page.open_source.js";
import {printAgentWebError} from "~/server/agents/web/print_agent_web_error.open_source.js";
import {withInstrumentedAgentWebSessionStorage} from "~/server/agents/web/with_instrumented_agent_web_session_storage.open_source.js";
import {parseMarkdownTree} from "~/shared/api/content/parse_api_content_from_markdown.open_source.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    NotFoundError,
} from "~/shared/error/error.open_source.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.open_source.js";
import {Mutex} from "~/shared/helpers/async/mutex.open_source.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.open_source.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.open_source.js";
import {Lazy} from "~/shared/helpers/control/lazy.open_source.js";
import {getOrSetDefaultMapValue} from "~/shared/helpers/map/get_or_set_default_map_value.open_source.js";
import {quote} from "~/shared/helpers/string/quote.open_source.js";

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
): Promise<{isError: boolean; response: string}> {
    return await context.span.withSpan("Call agent web update tool", async span => {
        return await withInstrumentedAgentWebSessionStorage(
            span,
            context.storage,
            async storage => {
                let isError: boolean;
                let response: string;
                const additionalOutput: Array<string> = [];

                try {
                    response = await actuallyCallAgentWebUpdateTool(
                        {...context, span, storage},
                        options,
                        {
                            addAdditionalOutput: output => additionalOutput.push(output.trim()),
                        },
                    );

                    isError = false;
                } catch (error) {
                    span.addException(error);

                    response = printAgentWebError(
                        `Couldn\u2019t update ${quote(options.path)}`,
                        error,
                    );

                    isError = true;
                }

                if (additionalOutput.length > 0) {
                    response += `\n\n${additionalOutput.join("\n\n")}`;
                }

                return {isError, response};
            },
        );
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
    {
        addAdditionalOutput,
    }: {
        addAdditionalOutput: (output: string) => void;
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

        if (!readResponse || readResponse.expirationTime < Date.now()) {
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
                    // This error message was [derived from OpenCode][1].
                    //
                    // [1]:
                    //     https://github.com/anomalyco/opencode/blob/4961d72c0fa23ee23bca9ea59b86a2b13bcf4427/packages/opencode/src/tool/edit.ts#L665
                    displayMessage: errorDisplayMessage`Multiple matches were found for the \`old\` string ${quotedString}. Provide more surrounding context to make the match unique. If you want to update every match of the \`old\` string you may use the \`replaceAll\` arg, however we recommend only making one update at a time to avoid unintentional updates.`,
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
        // TODO(calebmer, #agents-web): Once we have an update that might have a partial
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
                {addAdditionalOutput},
            );
        } catch (error) {
            if (isPartialSuccess) {
                addAdditionalOutput(
                    `This update was a partial success. You must call the \`read\` tool again for ${quote(originalPath)} to find out which parts of the update were successful.`,
                );
            }

            throw error;
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

    return "Update was successful.";
}

async function updateAgentWebPageLink(
    context: AgentWebContext,
    pathname: string,
    oldPageMetadata: AgentWebPageMetadata,
    // Lazily compute the `oldResponse` since sometimes we don't need it.
    oldResponseLazy: Lazy<Root>,
    newResponse: Root,
    options: {addAdditionalOutput: (output: string) => void},
): Promise<AgentWebPageMetadata> {
    switch (oldPageMetadata.type) {
        case "Skill": {
            throw new InvalidArgumentError("Can\u2019t update skills", {
                displayMessage: errorDisplayMessage`Can\u2019t update a \`/skill/...\` page. Skills are read-only documentation written by the Alpine team to help you, the agent, navigate and update context in Alpine. If you think there\u2019s a mistake in a skill, please reach out to ${errorDisplayMessage.supportLink}.`,
            });
        }
        case "Account": {
            const oldResponse = oldResponseLazy.get();

            const [oldPage, newPage] = await runAllPromises([
                parseAgentWebAccountPage(context.storage, oldPageMetadata.id, oldResponse),
                parseAgentWebAccountPage(context.storage, oldPageMetadata.id, newResponse),
            ]);

            return updateAgentWebAccountPage(context, oldPageMetadata, oldPage, newPage);
        }
        case "Inbox": {
            const oldResponse = oldResponseLazy.get();

            const [oldPage, newPage] = await runAllPromises([
                parseAgentWebInboxPage(context.storage, oldPageMetadata.id, oldResponse),
                parseAgentWebInboxPage(context.storage, oldPageMetadata.id, newResponse),
            ]);

            return updateAgentWebInboxPage(context, oldPageMetadata, oldPage, newPage);
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
                    {document: {id: oldPageMetadata.id}, id: oldPageMetadata.threadId},
                    oldResponse,
                ),
                parseAgentWebDocumentThreadPage(
                    context.storage,
                    {document: {id: oldPageMetadata.id}, id: oldPageMetadata.threadId},
                    newResponse,
                ),
            ]);

            return await updateAgentWebDocumentThreadPage(
                context,
                pathname,
                oldPageMetadata,
                oldPage,
                newPage,
                options,
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
                options,
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
                options,
            );
        }
        case "Task": {
            const oldResponse = oldResponseLazy.get();

            const [oldPage, newPage] = await runAllPromises([
                parseAgentWebTaskPage(context.storage, oldPageMetadata.id, oldResponse),
                parseAgentWebTaskPage(context.storage, oldPageMetadata.id, newResponse),
            ]);

            return await updateAgentWebTaskPage(
                context,
                oldPageMetadata,
                oldPage,
                newPage,
                options,
            );
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
                options,
            );
        }
        case "TaskSubtasks": {
            const oldResponse = oldResponseLazy.get();

            const [oldPage, newPage] = await runAllPromises([
                parseAgentWebTaskSubtasksPage(context.storage, oldPageMetadata.id, oldResponse),
                parseAgentWebTaskSubtasksPage(context.storage, oldPageMetadata.id, newResponse),
            ]);

            return await updateAgentWebTaskSubtasksPage(
                context,
                oldPageMetadata,
                oldPage,
                newPage,
                options,
            );
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
                options,
            );
        }
        case "MyAccount": {
            throw new InvalidArgumentError("Can\u2019t update my account page", {
                displayMessage: errorDisplayMessage`Your identity is decided by how you\u2019ve authenticated and can\u2019t be changed.`,
            });
        }
        default:
            throw exhaustive(oldPageMetadata);
    }
}
