import {Root} from "mdast";
import {
    AgentWebContext,
    AgentWebContextWithoutStorage,
} from "~/server/agents/web/agent_web_context.js";
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
import {parseApiContentFromAgentWebMarkdownTree} from "~/server/agents/web/parse_api_content_from_agent_web_markdown.js";
import {printApiContentToAgentWebMarkdownTree} from "~/server/agents/web/print_api_content_to_agent_web_markdown.js";
import {
    ApiMentionTargetResponse,
    ApiTaskTargetResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {TaskId} from "~/shared/id/types/id_types.js";

export type AgentWebTaskMessageListPage =
    AgentWebMessagingPage<AgentWebTaskMessageListPagePreamble> & {
        readonly type: "TaskMessageList";
    };

export type AgentWebTaskMessageListPagePreamble = {
    readonly task: ApiTaskTargetResponse;
};

export type AgentWebTaskMessageListPageWithMetadata = AgentWebTaskMessageListPage & {
    readonly metadata: AgentWebTaskMessageListPageMetadata;
};

export type AgentWebTaskMessageListPageMetadata = AgentWebMessagingPageMetadata & {
    readonly type: "TaskMessageList";
    readonly id: TaskId;
};

function buildAgentWebTaskMessageListPage(
    page: AgentWebMessagingPageWithMetadata<AgentWebTaskMessageListPagePreamble>,
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
    target: ApiMentionTargetResponse;
    preamble: AgentWebTaskMessageListPagePreamble;
}> {
    const {
        data: {
            mention: {target},
        },
    } = await context.api.get(context.span, "/tasks/{id}/mention", {
        params: {path: {id}},
    });

    return {
        target,
        preamble: {task: target},
    };
}

export function normalizeAgentWebTaskMessageListPage<Page extends AgentWebTaskMessageListPage>(
    page: Page,
): Page {
    return normalizeAgentWebMessagingPage(page, {
        normalizePreamble: (normalizer, preamble) => {
            normalizer.normalizeTarget(preamble.task);
        },
    });
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
                            {type: "Mention", target: preamble.task},
                            {type: "Text", text: "."},
                        ],
                    },
                ],
            });
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

            if (secondElement.type !== "Mention" || secondElement.target.type !== "Task") {
                throw createError();
            }

            return {task: secondElement.target};
        },
    });

    return {...page, type: "TaskMessageList"};
}
