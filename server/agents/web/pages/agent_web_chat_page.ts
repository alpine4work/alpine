import {Root} from "mdast";
import {AgentWebContextWithoutStorage} from "~/server/agents/web/agent_web_context.js";
import {AgentWebPageLink} from "~/server/agents/web/agent_web_page_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {
    AgentWebMessagingPage,
    AgentWebMessagingPageMetadata,
    AgentWebMessagingPageWithMetadata,
    agentWebMessagingPageMessageNouns,
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
import {printMarkdownPhrasingContentText} from "~/server/agents/web/print_markdown_phrasing_content_text.js";
import {intoApiAccountTarget} from "~/shared/api/specification/into_api_account_target.js";
import {
    ApiAccountTargetResponse,
    ApiContentInlineElementResponse,
    ApiContentResponse,
    ApiMentionTargetResponse,
} from "~/shared/api/specification/types/api_specification_convenience_types.js";
import {InvalidArgumentError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {interleaveArray} from "~/shared/helpers/array/interleave_array.js";
import {
    NonEmptyReadonlyArray,
    assertNonEmptyReadonlyArray,
} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {ChatId} from "~/shared/id/types/id_types.js";

export type AgentWebChatPage = AgentWebMessagingPage<AgentWebChatPagePreamble> & {
    readonly type: "Chat";
};

export type AgentWebChatPagePreamble =
    | {
          readonly type: "Direct";
          readonly members: NonEmptyReadonlyArray<ApiAccountTargetResponse>;
      }
    | {
          readonly type: "Room";
          readonly name: string;
      };

export type AgentWebChatPageWithMetadata = AgentWebChatPage & {
    readonly metadata: AgentWebChatPageMetadata;
};

export type AgentWebChatPageMetadata = AgentWebMessagingPageMetadata & {
    readonly type: "Chat";
    readonly id: ChatId;
};

function buildAgentWebChatPage(
    page: AgentWebMessagingPageWithMetadata<AgentWebChatPagePreamble>,
    id: ChatId,
): AgentWebChatPageWithMetadata {
    return {
        ...page,
        type: "Chat",
        metadata: buildAgentWebChatPageMetadata(page.metadata, id),
    };
}

function buildAgentWebChatPageMetadata(
    metadata: AgentWebMessagingPageMetadata,
    id: ChatId,
): AgentWebChatPageMetadata {
    return {...metadata, type: "Chat", id};
}

export async function readAgentWebChatPage(
    context: AgentWebContextWithoutStorage,
    id: ChatId,
    {
        searchParams,
        limitLength,
        printPage,
        createPageLinkPathname,
    }: {
        searchParams: URLSearchParams;
        limitLength: number;
        printPage: (page: AgentWebChatPageWithMetadata) => Promise<string>;
        createPageLinkPathname: (pageLink: AgentWebPageLink) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebChatPageMetadata}> {
    const result = await readAgentWebMessagingPage(context, {
        messageNouns: agentWebMessagingPageMessageNouns,
        room: {type: "Chat", id},
        roomMetadataPromise: getChatRoomMetadata(context, id),
        defaultDirection: "End",
        searchParams,
        limitLength,
        printPage: page => printPage(buildAgentWebChatPage(page, id)),
        createPageLinkPathname,
    });

    return {
        response: result.response,
        metadata: buildAgentWebChatPageMetadata(result.metadata, id),
    };
}

export async function readAgentWebChatMessagePage(
    context: AgentWebContextWithoutStorage,
    id: ChatId,
    index: number,
    {
        limitLength,
        printPage,
        createPageLinkPathname,
    }: {
        limitLength: number;
        printPage: (page: AgentWebChatPageWithMetadata) => Promise<string>;
        createPageLinkPathname: (pageLink: AgentWebPageLink) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebChatPageMetadata}> {
    const result = await readAgentWebMessagingPageAroundMessage(context, {
        messageNouns: agentWebMessagingPageMessageNouns,
        room: {type: "Chat", id},
        roomMetadataPromise: getChatRoomMetadata(context, id),
        around: {startMessageIndex: index, endMessageIndex: index + 1},
        limitLength,
        printPage: page => printPage(buildAgentWebChatPage(page, id)),
        createPageLinkPathname,
    });

    return {
        response: result.response,
        metadata: buildAgentWebChatPageMetadata(result.metadata, id),
    };
}

async function getChatRoomMetadata(
    context: AgentWebContextWithoutStorage,
    id: ChatId,
): Promise<{
    target: ApiMentionTargetResponse;
    preamble: AgentWebChatPagePreamble;
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
                preamble: {
                    type: "Direct",
                    members: assertNonEmptyReadonlyArray(
                        chat.members.map(member => intoApiAccountTarget(member.account)),
                    ),
                },
            };
        }
        case "Room": {
            return {
                target: {type: "Chat", id, title: chat.name},
                preamble: {
                    type: "Room",
                    name: chat.name,
                },
            };
        }
        default:
            throw exhaustive(chat);
    }
}

export async function updateAgentWebChatPage(
    context: AgentWebContextWithoutStorage,
    pathname: string,
    oldPageMetadata: AgentWebChatPageMetadata,
    oldPage: AgentWebChatPage,
    newPage: AgentWebChatPage,
): Promise<AgentWebChatPageMetadata & {type: "Chat"}> {
    const newPageMetadata = await updateAgentWebMessagingPage(context, {
        messageNouns: agentWebMessagingPageMessageNouns,
        pathname,
        room: {type: "Chat", id: oldPageMetadata.id},
        oldPageMetadata,
        oldPage,
        newPage,
        arePreamblesEqual: (oldPreamble, newPreamble) => {
            switch (oldPreamble.type) {
                case "Direct": {
                    if (newPreamble.type !== "Direct") return false;

                    // NOCOMMIT: Test that we can't update chat room members.
                    return isDeepEqual(
                        newPreamble.members.map(account => account.id),
                        oldPreamble.members.map(account => account.id),
                    );
                }
                case "Room": {
                    if (newPreamble.type !== "Room") return false;

                    // NOCOMMIT: Update chat room name?
                    return oldPreamble.name === newPreamble.name;
                }
                default:
                    throw exhaustive(oldPreamble);
            }
        },
    });

    return {...newPageMetadata, type: "Chat", id: oldPageMetadata.id};
}

export function normalizeAgentWebChatPage<Page extends AgentWebChatPage>(page: Page): Page {
    return normalizeAgentWebMessagingPage(page, {
        normalizePreamble: (normalizer, preamble) => {
            switch (preamble.type) {
                case "Direct": {
                    for (const member of preamble.members) normalizer.normalizeTarget(member);
                    break;
                }
                case "Room": {
                    break;
                }
                default:
                    throw exhaustive(preamble);
            }
        },
    });
}

export async function printAgentWebChatPage(
    storage: AgentWebSessionStorage,
    id: ChatId,
    page: AgentWebChatPage,
): Promise<Root> {
    return await printAgentWebMessagingPage(storage, id, page, {
        messageNouns: agentWebMessagingPageMessageNouns,
        printPreamble: async (storage, preamble) => {
            switch (preamble.type) {
                case "Direct": {
                    const mentions: Array<ApiContentInlineElementResponse> = preamble.members.map(
                        member => ({type: "Mention", target: member}),
                    );

                    let mentionsPrettyConjunctionList: Array<ApiContentInlineElementResponse>;

                    assert(mentions.length > 0);

                    if (mentions.length === 1) {
                        mentionsPrettyConjunctionList = mentions;
                    } else if (mentions.length === 2) {
                        mentionsPrettyConjunctionList = [
                            mentions[0]!,
                            {type: "Text", text: " and "},
                            mentions[1]!,
                        ];
                    } else {
                        mentionsPrettyConjunctionList = [
                            ...interleaveArray(
                                mentions.slice(0, -1),
                                cast<ApiContentInlineElementResponse>({type: "Text", text: ", "}),
                            ),
                            {type: "Text", text: ", and "},
                            mentions[mentions.length - 1]!,
                        ];
                    }

                    const content: ApiContentResponse = {
                        elements: [
                            {
                                type: "Paragraph",
                                elements: [
                                    {type: "Text", text: "Chat with "},
                                    ...mentionsPrettyConjunctionList,
                                    {type: "Text", text: "."},
                                ],
                            },
                        ],
                    };

                    return await printApiContentToAgentWebMarkdownTree(storage, content);
                }
                case "Room": {
                    return {
                        type: "root",
                        children: [
                            {
                                type: "heading",
                                depth: 1,
                                children: [{type: "text", value: preamble.name}],
                            },
                        ],
                    };
                }
                default:
                    throw exhaustive(preamble);
            }
        },
    });
}

export async function parseAgentWebChatPage(
    storage: AgentWebSessionStorage,
    id: ChatId | null,
    root: Root,
): Promise<AgentWebChatPage> {
    const page = await parseAgentWebMessagingPage(storage, id, root, {
        messageNouns: agentWebMessagingPageMessageNouns,
        parsePreamble: async (storage, preamble): Promise<AgentWebChatPagePreamble> => {
            const createError = () => {
                return new InvalidArgumentError("Invalid chat preamble", {
                    displayMessage: errorDisplayMessage`Chat markdown must start with \u201CChat with\u201D followed by a list of chat members (e.g. \`Chat with [John](/human/john-doe) and [Jane](/human/jane-doe).\` or for chats with 2+ members \`Chat with A, B, and C.\`). Chat markdown for named chat rooms must start with a markdown h1 (e.g. \`# My Chat Room\`). Try again with a proper start to chat markdown on line 1.`,
                });
            };

            if (
                preamble.children.length === 1 &&
                preamble.children[0]!.type === "heading" &&
                preamble.children[0].depth === 1
            ) {
                return {
                    type: "Room",
                    name: printMarkdownPhrasingContentText(preamble.children[0].children),
                };
            }

            const preambleContent = await parseApiContentFromAgentWebMarkdownTree(storage, root);

            if (
                preambleContent.elements.length !== 1 ||
                preambleContent.elements[0]?.type !== "Paragraph"
            ) {
                throw createError();
            }

            const elements = preambleContent.elements[0].elements;

            if (elements.length === 0) {
                throw createError();
            }

            const firstElement = elements[0]!;
            const lastElement = elements[elements.length - 1]!;

            if (
                firstElement.type !== "Text" ||
                firstElement.text !== "Chat with " ||
                // The period after "Chat with" is optional in case the agent omits it.
                (lastElement.type !== "Text" && lastElement.type !== "Mention") ||
                (lastElement.type === "Text" && lastElement.text !== ".")
            ) {
                throw createError();
            }

            const actualElements = elements.slice(
                1,
                lastElement.type === "Text" ? elements.length - 1 : elements.length,
            );

            if (actualElements.length === 0) {
                throw createError();
            }

            if (actualElements.length === 1) {
                const mentionElement = actualElements[0]!;
                if (mentionElement.type !== "Mention" || mentionElement.target.type !== "Account") {
                    throw createError();
                }

                return {type: "Direct", members: [mentionElement.target]};
            }

            if (actualElements.length === 3) {
                const mention1Element = actualElements[0]!;
                const textElement = actualElements[1]!;
                const mention2Element = actualElements[2]!;

                if (
                    textElement.type !== "Text" ||
                    // Support with and without the Oxford comma, a reasonable change for the agent to
                    // make.
                    (textElement.text !== " and " && textElement.text !== ", and ")
                ) {
                    throw createError();
                }

                if (
                    mention1Element.type !== "Mention" ||
                    mention1Element.target.type !== "Account" ||
                    mention2Element.type !== "Mention" ||
                    mention2Element.target.type !== "Account"
                ) {
                    throw createError();
                }

                return {type: "Direct", members: [mention1Element.target, mention2Element.target]};
            }

            const firstMentionElement = actualElements[0]!;

            if (
                firstMentionElement.type !== "Mention" ||
                firstMentionElement.target.type !== "Account"
            ) {
                throw createError();
            }

            const members: Array<ApiAccountTargetResponse> = [firstMentionElement.target];

            if ((actualElements.length - 1) % 2 !== 0) {
                throw createError();
            }

            for (let index = 1; index < actualElements.length; index += 2) {
                const textElement = actualElements[index]!;
                const mentionElement = actualElements[index + 1]!;

                if (
                    textElement.type !== "Text" ||
                    (index !== actualElements.length - 2
                        ? textElement.text !== ", "
                        : // Support with and without the Oxford comma, a reasonable change for the agent to
                          // make.
                          textElement.text !== " and " && textElement.text !== ", and ")
                ) {
                    throw createError();
                }

                if (mentionElement.type !== "Mention" || mentionElement.target.type !== "Account") {
                    throw createError();
                }

                members.push(mentionElement.target);
            }

            return {type: "Direct", members: assertNonEmptyReadonlyArray(members)};
        },
    });

    return {...page, type: "Chat"};
}
