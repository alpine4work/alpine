import {Root} from "mdast";
import {
    AgentWebContext,
    AgentWebContextWithoutStorage,
} from "~/server/agents/web/agent_web_context.js";
import {
    AgentWebPageStoredLink,
    printAgentWebPageStoredLinkLabel,
} from "~/server/agents/web/agent_web_page_stored_link.js";
import {AgentWebSessionStorage} from "~/server/agents/web/agent_web_session_storage.js";
import {createAgentWebPageStoredLinkPathname} from "~/server/agents/web/internal/create_agent_web_page_stored_link_pathname.js";
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
import {
    updateAgentWebMessagingPage,
    updateAgentWebMessagingPageUnexpectedNewMessageIndexesErrorMessage,
} from "~/server/agents/web/pages/messaging/update_agent_web_messaging_page.js";
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
import {joinPrettyConjunctionList} from "~/shared/design/join_pretty_conjunction_list.js";
import {
    FailedPreconditionError,
    InvalidArgumentError,
    UnimplementedError,
} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {interleaveArray} from "~/shared/helpers/array/interleave_array.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";
import {
    NonEmptyReadonlyArray,
    assertNonEmptyReadonlyArray,
} from "~/shared/helpers/array/non_empty_readonly_array.js";
import {mapMaybePromise} from "~/shared/helpers/async/map_maybe_promise.js";
import {assert} from "~/shared/helpers/control/assert.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {isDeepEqual} from "~/shared/helpers/control/is_deep_equal.js";
import {Lazy} from "~/shared/helpers/control/lazy.js";
import {mapMaybeThunk} from "~/shared/helpers/control/map_maybe_thunk.js";
import {memoMaybeThunk} from "~/shared/helpers/control/memo_maybe_thunk.js";
import {unwrapMaybeThunk} from "~/shared/helpers/control/unwrap_maybe_thunk.js";
import {defaultLocale} from "~/shared/helpers/intl/locale.js";
import {printPrettyNumber} from "~/shared/helpers/number/print_pretty_number.js";
import {isObject} from "~/shared/helpers/object/is_object.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.js";
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
    context: AgentWebContext,
    id: ChatId,
    {
        searchParams,
        limitLength,
        printPage,
    }: {
        searchParams: URLSearchParams;
        limitLength: number;
        printPage: (page: AgentWebChatPageWithMetadata) => Promise<string>;
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
    });

    return {
        response: result.response,
        metadata: buildAgentWebChatPageMetadata(result.metadata, id),
    };
}

export async function readAgentWebChatMessagePage(
    context: AgentWebContext,
    id: ChatId,
    index: number,
    {
        limitLength,
        printPage,
    }: {
        limitLength: number;
        printPage: (page: AgentWebChatPageWithMetadata) => Promise<string>;
    },
): Promise<{response: string; metadata: AgentWebChatPageMetadata}> {
    const result = await readAgentWebMessagingPageAroundMessage(context, {
        messageNouns: agentWebMessagingPageMessageNouns,
        room: {type: "Chat", id},
        roomMetadataPromise: getChatRoomMetadata(context, id),
        around: {startMessageIndex: index, endMessageIndex: index + 1},
        limitLength,
        printPage: page => printPage(buildAgentWebChatPage(page, id)),
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

export async function createAgentWebChatPage(
    context: AgentWebContext,
    newPage: AgentWebChatPage,
): Promise<{
    pageMetadata: AgentWebChatPageMetadata;
    pageLink: Extract<AgentWebPageStoredLink, {type: "Chat"}>;
}> {
    let wasCreated = false;

    // Creation is placed in a `Lazy` since we want to create the chat at the last
    // possible moment before it's needed. We want `updateAgentWebChatPage()` to run
    // any validations first before we create the chat and then only right before
    // `updateAgentWebChatPage()` tries to create new chat messages do we want to
    // create the chat.
    const createPromise = new Lazy(async () => {
        wasCreated = true;

        const {
            data: {chat},
        } = await context.api.post(context.span, "/chats", {
            body: {
                spaceId: context.spaceId,
                chat:
                    newPage.preamble.type === "Direct"
                        ? {
                              type: "Direct",
                              members: newPage.preamble.members.map(account => ({account})),
                          }
                        : {type: "Room", name: newPage.preamble.name},
            },
        });

        const pageLink: Extract<AgentWebPageStoredLink, {type: "Chat"}> = {
            type: "Chat",
            id: chat.id,
            title: chat.type === "Direct" ? chat.title : chat.name,
        };

        return {
            chat,
            pageLink,
        };
    });

    try {
        const pageMetadata = await updateAgentWebChatPage(
            context,
            async () => {
                const {pageLink} = await createPromise.get();
                return await createAgentWebPageStoredLinkPathname(context.storage, pageLink);
            },
            async () => {
                const {chat} = await createPromise.get();
                return {type: "Chat", id: chat.id, messages: []};
            },
            {
                type: "Chat",
                preamble: newPage.preamble,
                pagination: null,
                isEndOfMessages: true,
                blocks: [],
            },
            newPage,
        );

        const {pageLink} = await createPromise.get();

        return {pageMetadata, pageLink};
    } catch (error) {
        // If the chat was successfully created then we want to change the `displayMessage`
        // for the unexpected new messages error.
        if (wasCreated) {
            const {chat, pageLink} = await createPromise.get();

            if (
                chat.type === "Direct" &&
                error instanceof FailedPreconditionError &&
                error.message === updateAgentWebMessagingPageUnexpectedNewMessageIndexesErrorMessage
            ) {
                assert("newMessages" in error);
                const {newMessages} = error;
                assert(isReadonlyArray(newMessages));
                assert(newMessages.length > 0);
                const firstNewMessage = newMessages[0]!;
                assert(isObject(firstNewMessage));
                assert("index" in firstNewMessage);
                const {index} = firstNewMessage;
                assert(typeof index === "number");
                assert(index >= 0);
                assert(Number.isInteger(index));

                const pathname = await createAgentWebPageStoredLinkPathname(
                    context.storage,
                    pageLink,
                );

                const chatSummaryEntries: Array<string> = [
                    ...chat.members.slice(0, 2).map(member => member.account.shortName),
                ];

                if (chat.members.length > 2) {
                    chatSummaryEntries.push(
                        printPrettyNumber(defaultLocale, chat.members.length - 2, "other"),
                    );
                }

                const chatSummary = joinPrettyConjunctionList(chatSummaryEntries);

                throw Object.assign(
                    new FailedPreconditionError(
                        updateAgentWebMessagingPageUnexpectedNewMessageIndexesErrorMessage,
                        {
                            cause: error,
                            displayMessage: errorDisplayMessage`Create was successful. Found chat: [${printAgentWebPageStoredLinkLabel(pageLink)}](${pathname}). ${newMessages.length === 1 ? `The message you added was` : `The messages you added were`} created, but a chat with ${chatSummary} already existed so your ${newMessages.length === 1 ? `message was` : `messages were`} added to the end of the existing chat. If you want to see the previous messages in the chat before the new ${newMessages.length === 1 ? `message` : `messages`} you added then call the \`read\` tool with \`${pathname}?before=${index}\`.`,
                        },
                    ),
                    {newMessages},
                );
            }
        }

        throw error;
    }
}

export async function updateAgentWebChatPage(
    context: AgentWebContextWithoutStorage,
    pathname: MaybeThunk<MaybePromise<string>>,
    oldPageMetadata: MaybeThunk<MaybePromise<AgentWebChatPageMetadata>>,
    oldPage: AgentWebChatPage,
    newPage: AgentWebChatPage,
): Promise<AgentWebChatPageMetadata> {
    switch (oldPage.preamble.type) {
        case "Direct": {
            if (newPage.preamble.type === "Room") {
                // TODO(#agents-web): Implement convert direct chat to room chat endpoint. I feel
                // like this could definitely use some speed bumps given it's non-reversible.
                throw new UnimplementedError(
                    "Convert direct chat to room chat API endpoint hasn\u2019t been implemented",
                );
            }

            if (
                !isDeepEqual(
                    oldPage.preamble.members.map(account => account.id),
                    newPage.preamble.members.map(account => account.id),
                )
            ) {
                throw new InvalidArgumentError("Can\u2019t change the members of a direct chat", {
                    displayMessage: errorDisplayMessage`Can\u2019t add or remove members from a chat. Instead try calling the \`create\` tool to create a new chat instead. If you must preserve the chat message history then try using the \`update\` tool to convert this chat into a named chat room by replacing the chat member list with a markdown h1 with the new chat room name. In most cases it\u2019s better to use the \`create\` tool to create a new chat because converting to a named chat room is an irreversible decision.`,
                });
            }
            break;
        }
        case "Room": {
            if (newPage.preamble.type === "Direct") {
                throw new InvalidArgumentError(
                    "Can\u2019t convert a room chat into a direct chat",
                    {
                        displayMessage: errorDisplayMessage`A named chat room can\u2019t be converted into a direct chat. Try calling the \`create\` tool to create a new direct chat instead.`,
                    },
                );
            }

            if (oldPage.preamble.name !== newPage.preamble.name) {
                // TODO(#agents-web): Implement chat room rename API endpoint.
                throw new UnimplementedError(
                    "Update room chat name API endpoint hasn\u2019t been implemented",
                );
            }
            break;
        }
        default:
            throw exhaustive(oldPage.preamble);
    }

    // Only call the `oldPageMetadata` thunk once. We're about to reference it multiple
    // times and don't want each reference to call the underlying thunk again when
    // unwrapped.
    oldPageMetadata = memoMaybeThunk(oldPageMetadata);

    const newPageMetadata = await updateAgentWebMessagingPage(context, {
        messageNouns: agentWebMessagingPageMessageNouns,
        pathname,
        room: mapMaybeThunk(oldPageMetadata, oldPageMetadata =>
            mapMaybePromise(oldPageMetadata, oldPageMetadata => ({
                type: "Chat",
                id: oldPageMetadata.id,
            })),
        ),
        oldPageMetadata,
        oldPage,
        newPage,
    });

    const {id} = await unwrapMaybeThunk(oldPageMetadata);

    return {...newPageMetadata, type: "Chat", id};
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
