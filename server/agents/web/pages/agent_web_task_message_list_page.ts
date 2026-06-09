import {Root} from "mdast";
import {
    AgentWebContext,
    AgentWebContextWithoutStorage,
} from "~/server/agents/web/agent_web_context.js";
import {AgentWebPageRoutedLink} from "~/server/agents/web/agent_web_page_routed_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {
    AgentWebMessagingPage,
    AgentWebMessagingPageMetadata,
    AgentWebMessagingPageWithMetadata,
    agentWebMessagingPageCommentNouns,
} from "~/server/agents/web/pages/messaging/agent_web_messaging_page.js";
import {normalizeAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/normalize_agent_web_messaging_page.js";
import {parseAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/parse_agent_web_messaging_page.js";
import {printAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/print_agent_web_messaging_page.js";
import {
    readAgentWebMessagingPage,
    readAgentWebMessagingPageAroundMessage,
} from "~/server/agents/web/pages/messaging/read_agent_web_messaging_page.js";
import {updateAgentWebMessagingPage} from "~/server/agents/web/pages/messaging/update_agent_web_messaging_page.js";
import {parseApiContentFromAgentWebMarkdownTree} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdownTree} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {normalizeApiReference} from "~/shared/api/markdown/normalize_api_content.js";
import {ApiTaskReferenceResponse} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {TaskId} from "~/shared/id/types/id_types.js";

export type AgentWebTaskMessageListPage = AgentWebMessagingPage<
    AgentWebTaskMessageListPagePreamble,
    never
> & {
    readonly type: "TaskMessageList";
};

export type AgentWebTaskMessageListPagePreamble = {
    readonly task: ApiTaskReferenceResponse;
};

export type AgentWebTaskMessageListPageWithMetadata = AgentWebTaskMessageListPage & {
    readonly metadata: AgentWebTaskMessageListPageMetadata;
};

export type AgentWebTaskMessageListPageMetadata = AgentWebMessagingPageMetadata & {
    readonly type: "TaskMessageList";
    readonly id: TaskId;
};

function buildAgentWebTaskMessageListPage(
    page: AgentWebMessagingPageWithMetadata<AgentWebTaskMessageListPagePreamble, never>,
    id: TaskId,
): AgentWebTaskMessageListPageWithMetadata {
    return {
        ...page,
        type: "TaskMessageList",
        metadata: buildAgentWebTaskMessageListPageMetadata(page.metadata, id),
    };
}

function buildAgentWebTaskMessageListPageMetadata(
    metadata: AgentWebMessagingPageMetadata,
    id: TaskId,
): AgentWebTaskMessageListPageMetadata {
    return {...metadata, type: "TaskMessageList", id};
}

export async function readAgentWebTaskMessageListPage(
    context: AgentWebContext,
    id: TaskId,
    {
        searchParams,
        limitLength,
        printPage,
    }: {
        searchParams: URLSearchParams;
        limitLength: number;
        printPage: (page: AgentWebTaskMessageListPageWithMetadata) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebTaskMessageListPageMetadata}> {
    const result = await readAgentWebMessagingPage(context, {
        messageNouns: agentWebMessagingPageCommentNouns,
        room: {type: "Task", id},
        roomMetadataPromise: getTaskRoomMetadata(context, id),
        defaultDirection: "Start",
        searchParams,
        limitLength,
        printPage: page => printPage(buildAgentWebTaskMessageListPage(page, id)),
    });

    return {
        response: result.response,
        metadata: buildAgentWebTaskMessageListPageMetadata(result.metadata, id),
    };
}

export async function readAgentWebTaskMessageListMessagePage(
    context: AgentWebContext,
    id: TaskId,
    index: number,
    {
        limitLength,
        printPage,
    }: {
        limitLength: number;
        printPage: (page: AgentWebTaskMessageListPageWithMetadata) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebTaskMessageListPageMetadata}> {
    const result = await readAgentWebMessagingPageAroundMessage(context, {
        messageNouns: agentWebMessagingPageCommentNouns,
        room: {type: "Task", id},
        roomMetadataPromise: getTaskRoomMetadata(context, id),
        around: {startMessageIndex: index, endMessageIndex: index + 1},
        limitLength,
        printPage: page => printPage(buildAgentWebTaskMessageListPage(page, id)),
    });

    return {
        response: result.response,
        metadata: buildAgentWebTaskMessageListPageMetadata(result.metadata, id),
    };
}

async function getTaskRoomMetadata(
    context: AgentWebContextWithoutStorage,
    id: TaskId,
): Promise<{
    pageLink: Extract<AgentWebPageRoutedLink, {type: "TaskMessageList"}>;
    preamble: AgentWebTaskMessageListPagePreamble;
    startCustomBlock: null;
}> {
    const {
        data: {reference},
    } = await context.api.get(context.span, "/tasks/{id}/reference", {
        params: {path: {id}},
    });

    return {
        pageLink: {
            type: "TaskMessageList",
            task: reference,
        },
        preamble: {task: reference},
        startCustomBlock: null,
    };
}

export function normalizeAgentWebTaskMessageListPage<Page extends AgentWebTaskMessageListPage>(
    page: Page,
): Page {
    return normalizeAgentWebMessagingPage(page, {
        normalizePreamble: (normalizer, preamble) => {
            normalizer.normalizeReference(preamble.task);
        },
        normalizeCustomBlock: () => {},
    });
}

export async function updateAgentWebTaskMessageListPage(
    context: AgentWebContextWithoutStorage,
    pathname: string,
    oldPageMetadata: AgentWebTaskMessageListPageMetadata,
    oldPage: AgentWebTaskMessageListPage,
    newPage: AgentWebTaskMessageListPage,
): Promise<AgentWebTaskMessageListPageMetadata> {
    if (
        !isDeepEqual(
            normalizeApiReference(oldPage.preamble.task),
            normalizeApiReference(newPage.preamble.task),
        )
    ) {
        throw new InvalidArgumentError("Can\u2019t update task comments preamble", {
            displayMessage: errorDisplayMessage`You can only update your \`<comment>\`s. You can\u2019t change which task the comments belong to on line 1. Try again with a more specific update that only changes the content of comments from you or adds new comments.`,
        });
    }

    const newPageMetadata = await updateAgentWebMessagingPage(context, {
        messageNouns: agentWebMessagingPageCommentNouns,
        pathname,
        room: {type: "Task", id: oldPageMetadata.id},
        oldPageMetadata,
        oldPage,
        newPage,
    });

    return {...newPageMetadata, type: "TaskMessageList", id: oldPageMetadata.id};
}

export async function printAgentWebTaskMessageListPage(
    storage: AgentWebSessionStorage,
    id: TaskId,
    page: AgentWebTaskMessageListPage,
): Promise<Root> {
    return await printAgentWebMessagingPage(storage, id, page, {
        messageNouns: agentWebMessagingPageCommentNouns,
        printPreamble: async (storage, preamble) => {
            return await printApiContentToAgentWebMarkdownTree(storage, {
                elements: [
                    {
                        type: "Paragraph",
                        elements: [
                            {type: "Text", text: "Comments on "},
                            {type: "Mention", reference: preamble.task},
                            {type: "Text", text: "."},
                        ],
                    },
                ],
            });
        },
        printCustomBlock: async (storage, block) => {
            // This type checks because `block` is `never`.
            throw exhaustive(block);
        },
    });
}

export async function parseAgentWebTaskMessageListPage(
    storage: AgentWebSessionStorage,
    id: TaskId | null,
    root: Root,
): Promise<AgentWebTaskMessageListPage> {
    const page = await parseAgentWebMessagingPage(storage, id, root, {
        messageNouns: agentWebMessagingPageCommentNouns,
        parsePreamble: async (storage, preamble): Promise<AgentWebTaskMessageListPagePreamble> => {
            const createError = () => {
                return new InvalidArgumentError("Invalid task message list preamble", {
                    displayMessage: errorDisplayMessage`Task comments markdown must start with \u201CComments on\u201D followed by a link to the task (e.g. \`Comments on [Do thing (Open)](/task/do-thing).\`). Try again with a proper start to task comments markdown on line 1.`,
                });
            };

            const preambleContent = await parseApiContentFromAgentWebMarkdownTree(
                storage,
                preamble,
            );

            if (
                preambleContent.elements.length !== 1 ||
                preambleContent.elements[0]?.type !== "Paragraph"
            ) {
                throw createError();
            }

            const elements = preambleContent.elements[0].elements;

            if (elements.length !== 2 && elements.length !== 3) {
                throw createError();
            }

            const firstElement = elements[0]!;
            const lastElement = elements[elements.length - 1]!;

            if (
                firstElement.type !== "Text" ||
                firstElement.text !== "Comments on " ||
                // The period after "Comments on" is optional in case the agent omits it.
                (lastElement.type !== "Text" && lastElement.type !== "Mention") ||
                (lastElement.type === "Text" && lastElement.text !== ".")
            ) {
                throw createError();
            }

            const secondElement = elements[1]!;

            if (secondElement.type !== "Mention" || secondElement.reference.type !== "Task") {
                throw createError();
            }

            return {task: secondElement.reference};
        },
        parseCustomBlockByTagName: {},
    });

    return {...page, type: "TaskMessageList"};
}
