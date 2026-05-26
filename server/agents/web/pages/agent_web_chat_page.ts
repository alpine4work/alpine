import {Root} from "mdast";
import {AgentWebContextWithoutStorage} from "~/server/agents/web/agent_web_context.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {
    AgentWebMessagingPageBase,
    agentWebMessagingPageMessageNouns,
    normalizeAgentWebMessagingPageBase,
    parseAgentWebMessagingPageBase,
    printAgentWebMessagingPageBase,
    readAgentWebMessagingPageBase,
    readAgentWebMessagingPageBaseAroundMessage,
    updateAgentWebMessagingPageBase,
} from "~/server/agents/web/pages/agent_web_messaging_page_base.js";
import {
    ApiContentInlineElementResponse,
    ApiMentionTargetResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {ChatId} from "~/shared/id/types/id_types.js";

export type AgentWebChatPage = AgentWebMessagingPageBase & {
    readonly type: "Chat";
};

export type AgentWebChatPageWithMetadata = AgentWebChatPage & {
    readonly metadata: AgentWebChatPageMetadata;
};

export type AgentWebChatPageMetadata = {
    readonly id: ChatId;
};

export async function readAgentWebChatPage(
    context: AgentWebContextWithoutStorage,
    id: ChatId,
    {
        searchParams,
        limitLength,
        computeLength,
    }: {
        searchParams: URLSearchParams;
        limitLength: number;
        computeLength: (page: AgentWebChatPageWithMetadata) => Promise<number>;
    },
): Promise<AgentWebChatPageWithMetadata> {
    const page = await readAgentWebMessagingPageBase<AgentWebChatPageWithMetadata>(
        agentWebMessagingPageMessageNouns,
        context,
        {
            room: {type: "Chat", id},
            roomMetadataPromise: getChatRoomMetadata(context, id),
            defaultDirection: "End",
            searchParams,
            limitLength,
            computeLength,
            buildPage: page => ({...page, type: "Chat", metadata: {id}}),
        },
    );

    return page;
}

export async function readAgentWebChatMessagePage(
    context: AgentWebContextWithoutStorage,
    id: ChatId,
    index: number,
    {
        limitLength,
        computeLength,
    }: {
        limitLength: number;
        computeLength: (page: AgentWebChatPageWithMetadata) => Promise<number>;
    },
): Promise<AgentWebChatPageWithMetadata> {
    const page = await readAgentWebMessagingPageBaseAroundMessage<AgentWebChatPageWithMetadata>(
        agentWebMessagingPageMessageNouns,
        context,
        {
            room: {type: "Chat", id},
            roomMetadataPromise: getChatRoomMetadata(context, id),
            around: {startMessageIndex: index, endMessageIndex: index + 1},
            limitLength,
            computeLength,
            buildPage: page => ({...page, type: "Chat", metadata: {id}}),
        },
    );

    return page;
}

export async function updateAgentWebChatPage(
    context: AgentWebContextWithoutStorage,
    pathname: string,
    oldPageMetadata: AgentWebChatPageMetadata,
    oldPage: AgentWebChatPage,
    newPage: AgentWebChatPage,
): Promise<AgentWebChatPageMetadata & {type: "Chat"}> {
    await updateAgentWebMessagingPageBase(agentWebMessagingPageMessageNouns, context, {
        pathname,
        room: {type: "Chat", id: oldPageMetadata.id},
        oldPage,
        newPage,
    });

    return {type: "Chat", id: oldPageMetadata.id};
}

async function getChatRoomMetadata(
    context: AgentWebContextWithoutStorage,
    id: ChatId,
): Promise<{
    target: ApiMentionTargetResponse;
    description: ReadonlyArray<ApiContentInlineElementResponse>;
}> {
    const {
        data: {chat},
    } = await context.api.get(context.span, "/chats/{id}", {
        params: {path: {id}},
    });

    switch (chat.type) {
        case "Direct": {
            return {
                target: {type: "Chat", id, title: chat.title},
                description: [{type: "Text", text: `in a chat with ${chat.title}`}],
            };
        }
        case "Room": {
            return {
                target: {type: "Chat", id, title: chat.name},
                description: [{type: "Text", text: `in ${chat.name}`}],
            };
        }
        default:
            throw exhaustive(chat);
    }
}

export function normalizeAgentWebChatPage<Page extends AgentWebChatPage>(page: Page): Page {
    return normalizeAgentWebMessagingPageBase(page);
}

export async function printAgentWebChatPage(
    storage: AgentWebSessionStorage,
    id: ChatId,
    page: AgentWebChatPage,
): Promise<Root> {
    return await printAgentWebMessagingPageBase(
        agentWebMessagingPageMessageNouns,
        storage,
        id,
        page,
    );
}

export async function parseAgentWebChatPage(
    storage: AgentWebSessionStorage,
    id: ChatId | null,
    root: Root,
): Promise<AgentWebChatPage> {
    const page = await parseAgentWebMessagingPageBase(
        agentWebMessagingPageMessageNouns,
        storage,
        id,
        root,
    );

    return {...page, type: "Chat"};
}
