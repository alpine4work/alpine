import {Parser} from "@lezer/common";
import {highlightCode} from "@lezer/highlight";
import {parser as lezerHtmlParser} from "@lezer/html";
import {parser as lezerJsonParser} from "@lezer/json";
import {parser as lezerMarkdownParser, parseCode as parseLezerMarkdownCode} from "@lezer/markdown";
import escapeHtml from "escape-html";
import {countTokens as countO200kBaseTokens} from "gpt-tokenizer/esm/encoding/o200k_base";
import OpenAi from "openai";
import prettier from "prettier";
import {useCallback, useMemo, useRef, useState} from "react";
import {usePress} from "react-aria";
import {
    deserializeChatIdForLoader,
    deserializeSpaceIdForLoader,
} from "~/app/helpers/deserialize_id_for_loader.js";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useLoaderDataWithSchema} from "~/client/remix/use_loader_data_with_schema.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {backgroundColorVar, colorSchemeVars} from "~/client/styles/styles.js";
import {getDynamoSeedConstants} from "~/server/dynamo/core/dynamo_seed_constants.js";
import {jsonWithSchema} from "~/server/remix/json_with_schema.js";
import {LoaderArgs} from "~/server/remix/loader_context.js";
import {
    authorizeSpaceAccess,
    getBotAccountIdForSpaceIfExists,
} from "~/server/spaces/spaces_actions.js";
import {ApiMessageRoomPath} from "~/shared/api/types/api_specification_convenience_types.js";
import {chatGptKnownBotId} from "~/shared/bots/known_bot_ids.js";
import {lezerClassHighlighter} from "~/shared/content/code/lezer_class_highlighter.js";
import {FailedPreconditionError} from "~/shared/error/error.js";
import {ErrorSchema} from "~/shared/error/error_schema.js";
import {runAllPromises} from "~/shared/helpers/async/run_all_promises.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {Schema, SchemaType} from "~/shared/schema/schema.js";
import {fetchWithTracer} from "~/shared/tracer/fetch_with_tracer.js";

type ChatGptConversationItem = SchemaType<typeof ChatGptConversationItemSchema>;

const ChatGptConversationItemSchema = Schema.unknown<
    (
        | OpenAi.Responses.ResponseInputItem.Message
        | OpenAi.Responses.ResponseInputItem.FunctionCallOutput
        | OpenAi.Responses.ResponseOutputItem
    ) & {
        tokenCount?: number;
        contentHtml?: string;
    }
>();

const ChatGptConversationStateResponseSchema = Schema.result(
    Schema.object({
        ok: Schema.value(true),
        items: Schema.array(ChatGptConversationItemSchema),
    }),
    Schema.object({
        ok: Schema.value(false),
        error: ErrorSchema,
    }),
);

const LoaderSchema = Schema.object({
    items: Schema.array(ChatGptConversationItemSchema),
});

export function meta() {
    return [{title: `ChatGPT Debugger${metaTitlePostfix}`}];
}

export async function loader({context: unauthenticatedContext, params}: LoaderArgs) {
    const context = (await unauthenticatedContext.actor.authenticate()).actor.authorizeSession();

    const spaceId = deserializeSpaceIdForLoader(params.spaceId ?? null);
    const chatId = deserializeChatIdForLoader(params.chatId ?? null);

    const chatGptBotId =
        process.env.NODE_ENV !== "production"
            ? getDynamoSeedConstants().chatGptBotId
            : chatGptKnownBotId;

    const [, chatGptAccountId] = await runAllPromises([
        // Safety check: Make sure the actor has access to the space.
        authorizeSpaceAccess(context, spaceId),

        getBotAccountIdForSpaceIfExists(context, chatGptBotId, spaceId),
    ]);

    if (!chatGptAccountId)
        throw new FailedPreconditionError("ChatGPT bot wasn’t instantiated in this space");

    // Construct the room path for the chat
    const roomPath: ApiMessageRoomPath = `/chats/${chatId}`;

    const accessToken =
        await context.loader.tokenAgent.privateSide.dangerouslySignShortLivedTokenForBotConversationState(
            {
                type: "Bot",
                spaceId,
                accountId: chatGptAccountId,
                // VERY IMPORTANT: Use the actor `AccountId` as the scope so we only see stuff
                // the actor has access to. If we use the `Chat` as the scope we're implicitly
                // granting access to the chat to any actor who tries to open this page!
                //
                // TODO(ifitzsimmons, #ai): Write an integration test to make sure permissions
                // work properly.
                scope: {type: "Account", accountId: context.actor.getAccountId()},
            },
        );

    const agentServiceUrl = assertExists(
        context.loader.agentServiceUrl,
        "Can’t debug agents if `agentServiceUrl` isn’t set",
    );

    const url = new URL(`${agentServiceUrl}/chat-gpt/conversation-state`);
    url.searchParams.set("accountId", chatGptAccountId);
    url.searchParams.set("roomPath", roomPath);
    url.searchParams.set("accessToken", accessToken);

    const conversationState = await fetchWithTracer(
        context.tracer.getRoot(),
        url,
        {
            serviceName: "AgentService",
            route: "/chat-gpt/conversation-state",
        },
        async response => {
            const result = ChatGptConversationStateResponseSchema.deserialize(
                await response.json(),
            );
            if (!result.ok) throw result.error;
            return result;
        },
    );

    const itemsWithContentHtml = conversationState.items.map(item => {
        let tokenCount: number | undefined;

        let content: {
            text: string;
            prettierParser: prettier.BuiltInParserName;
            lezerParser: Parser;
        } | null = null;

        switch (item.type) {
            case "message": {
                let text = "";

                for (const content of item.content) {
                    if (content.type === "input_text" || content.type === "output_text") {
                        text += content.text;
                    }
                }

                tokenCount = countO200kBaseTokens(text);

                content = {
                    text,
                    prettierParser: "markdown",
                    lezerParser: lezerMarkdownParser.configure(
                        parseLezerMarkdownCode({htmlParser: lezerHtmlParser}),
                    ),
                };
                break;
            }
            case "function_call": {
                content = {
                    text: item.arguments,
                    prettierParser: "json",
                    lezerParser: lezerJsonParser,
                };
                break;
            }
            case "function_call_output": {
                tokenCount = countO200kBaseTokens(item.output);

                content = {
                    text: item.output,
                    prettierParser: "markdown",
                    lezerParser: lezerMarkdownParser.configure(
                        parseLezerMarkdownCode({htmlParser: lezerHtmlParser}),
                    ),
                };
                break;
            }
        }

        if (!content) return item;

        // Technically `_world_` below isn't italicized if you're following the
        // CommonMark spec. Since text on an adjacent line to HTML is considered more
        // HTML.
        //
        // ```
        // <human name="Alice>
        // Hello, _world_!
        // </human>
        // ```
        //
        // In the following `_world_` is properly italicized:
        //
        // ```
        // <human name="Alice>
        //
        // Hello, _world_!
        //
        // </human>
        // ```
        //
        // The following adds extra newlines next to HTML open/close tags so Prettier
        // and Lezer (which are sticklers for valid syntax) parse our Markdown
        // correctly.
        if (content.prettierParser === "markdown") {
            content.text = content.text
                .replaceAll(/^<[a-z]+[^>]*>\n\n?/gm, substring =>
                    !substring.endsWith("\n\n") ? `${substring}\n` : substring,
                )
                .replaceAll(/\n\n?<\/[a-z]+[^>]*>$/gm, substring =>
                    !substring.startsWith("\n\n") ? `\n${substring}` : substring,
                );
        }

        const contentPrettyText = prettier.format(content.text, {
            parser: content.prettierParser,
            printWidth: 80,
            tabWidth: 2,
            proseWrap: "always",
        });

        let contentHtml = "";

        highlightCode(
            contentPrettyText,
            content.lezerParser.parse(contentPrettyText),
            lezerClassHighlighter.get(),
            (text: string, classes: string) => {
                if (classes.length === 0) {
                    contentHtml += escapeHtml(text);
                } else {
                    // eslint-disable-next-line string-quotes
                    contentHtml += `<span class="${classes}">${escapeHtml(text)}</span>`;
                }
            },
            () => {
                contentHtml += "\n";
            },
        );

        // Convert:
        //
        // ```
        // <human name="Alice>
        //
        // Hello, _world_!
        //
        // </human>
        // ```
        //
        // ...back into our unofficial but more readable syntax:
        //
        // ```
        // <human name="Alice>
        // Hello, _world_!
        // </human>
        // ```
        if (content.prettierParser === "markdown") {
            contentHtml = contentHtml
                .replaceAll(
                    /<span class="tok-punctuation">&lt;<\/span>.*?<span class="tok-punctuation">&gt;<\/span>\n\n/g,
                    substring => substring.slice(0, -1),
                )
                .replaceAll(
                    /\n\n<span class="tok-punctuation">&lt;\/<\/span>.*?<span class="tok-punctuation">&gt;<\/span>/g,
                    substring => substring.slice(1),
                );
        }

        return {...item, tokenCount, contentHtml};
    });

    return jsonWithSchema(LoaderSchema, {
        items: itemsWithContentHtml,
    });
}

export default function ChatGptDebugRoute() {
    const {items} = useLoaderDataWithSchema(LoaderSchema);

    return (
        <Box
            userSelect="text"
            fontStyle="code"
            fontSize="100"
            marginX="center"
            style={{maxWidth: "88ch", padding: "0.5lh 2ch"}}
        >
            {items.length === 0 ? (
                <Box color="grey-50" style={{padding: "1.5lh 2ch"}}>
                    No ChatGPT conversation history. Start chatting with ChatGPT then reload this
                    page to see the internal conversation format.
                </Box>
            ) : (
                items.map((item, index) => (
                    <ChatGptConversationItemView key={index} items={items} item={item} />
                ))
            )}
        </Box>
    );
}

function ChatGptConversationItemView({
    items,
    item,
}: {
    items: ReadonlyArray<ChatGptConversationItem>;
    item: ChatGptConversationItem;
}) {
    const itemRef = useRef<HTMLDivElement>(null);

    const scrollIntoView = useCallback(() => {
        assertExists(itemRef.current).scrollIntoView({behavior: "instant"});
    }, []);

    return (
        <Box ref={itemRef} style={{padding: "0.5lh 0"}}>
            <Box
                style={{
                    // Use `box-shadow` so it doesn't contribute to the carefully aligned
                    // monospace layout.
                    boxShadow: `0 0 0 1px ${colorSchemeVars["grey-10"]}`,
                }}
            >
                <Box
                    backgroundColor="grey-1"
                    display="flex"
                    justifyContent="space-between"
                    style={{padding: "1lh 2ch", gap: "2ch"}}
                >
                    <Box flexShrink="0" fontStyle="code-semi-bold">
                        {item.type === "message" ? (
                            <>
                                <Box
                                    display="inline"
                                    color={
                                        (
                                            {
                                                user: "blue-50",
                                                developer: "orange-50",
                                                system: "orange-50",
                                                assistant: "green-50",
                                            } as const
                                        )[item.role]
                                    }
                                >
                                    {item.role}
                                </Box>{" "}
                            </>
                        ) : item.type === "function_call" ||
                          item.type === "function_call_output" ? (
                            <>
                                <Box display="inline" color="purple-50">
                                    {item.type === "function_call"
                                        ? item.name
                                        : items.find(
                                              (
                                                  otherItem,
                                              ): otherItem is OpenAi.Responses.ResponseFunctionToolCallItem =>
                                                  otherItem.type === "function_call" &&
                                                  otherItem.call_id === item.call_id,
                                          )?.name}
                                </Box>{" "}
                            </>
                        ) : null}
                        {item.type}
                    </Box>
                    {(item.tokenCount !== undefined || "call_id" in item) && (
                        <Box display="inline" fontStyle="truncate-code-light" color="grey-40">
                            {item.tokenCount !== undefined && (
                                <>{(item.tokenCount / 1000).toFixed(1)}k tokens</>
                            )}
                            {"call_id" in item && (
                                <>
                                    {item.tokenCount !== undefined && ", "}
                                    {item.call_id
                                        // Truncate the `call_id` to 1/4th the actual size. That should be enough
                                        // entropy to identify different calls within a single conversation.
                                        .slice(0, -18)}
                                </>
                            )}
                        </Box>
                    )}
                </Box>
                {item.contentHtml && (
                    <ChatGptConversationItemViewContent
                        contentHtml={item.contentHtml}
                        onScrollIntoView={scrollIntoView}
                    />
                )}
            </Box>
        </Box>
    );
}

function ChatGptConversationItemViewContent({
    contentHtml,
    onScrollIntoView,
}: {
    contentHtml: string;
    onScrollIntoView: () => void;
}) {
    const lines = useMemo(() => contentHtml.split("\n"), [contentHtml]);
    let maxLineCount = 8;

    // Avoid truncating on an empty line if possible.
    if (lines.length >= maxLineCount && lines[maxLineCount - 1]!.length === 0) {
        maxLineCount--;
    }

    const [isShowingAll, setIsShowingAll] = useState(false);

    const {isPressed, pressProps} = usePress({
        onPress: () => setIsShowingAll(!isShowingAll),
    });

    const isShowingAllRef = useRef(isShowingAll);

    useLayoutEffectWithoutServerSideWarning(() => {
        if (isShowingAllRef.current === isShowingAll) return;
        isShowingAllRef.current = isShowingAll;

        // After collapsing content, make sure the item is still visible on screen.
        if (!isShowingAll) {
            onScrollIntoView();
        }
    }, [isShowingAll, onScrollIntoView]);

    return (
        <Box
            data-scrollbar="false"
            overflowX="auto"
            overflowY="hidden"
            style={{
                maxHeight: !isShowingAll ? `${maxLineCount + 4}lh` : undefined,

                // Use `box-shadow` so it doesn't contribute to the carefully aligned
                // monospace layout.
                boxShadow: `0 -1px 0 0 ${colorSchemeVars["grey-10"]}`,
            }}
        >
            <Box position="relative" zIndex="0">
                <pre
                    style={{width: "fit-content", padding: "1lh 2ch"}}
                    dangerouslySetInnerHTML={{__html: contentHtml}}
                />
                {lines.length > maxLineCount && (
                    <>
                        <Box style={{height: "2lh"}} />
                        <Box
                            position="absolute"
                            zIndex="10"
                            left="0"
                            right="0"
                            fontStyle="code-semi-bold"
                            pointerEvents={isShowingAll ? "none" : undefined}
                            style={{
                                top: !isShowingAll ? `${maxLineCount}lh` : undefined,
                                bottom: isShowingAll ? "-1lh" : undefined,
                                height: "5lh",
                                padding: "2lh 2ch",
                                background: !isShowingAll
                                    ? `linear-gradient(to bottom, transparent, ${backgroundColorVar} 1.25lh)`
                                    : undefined,
                            }}
                        >
                            <FocusRing>
                                <Box
                                    {...pressProps}
                                    tabIndex={0}
                                    display="inline"
                                    cursor="pointer"
                                    pointerEvents="auto"
                                    userSelect="none"
                                    opacity={isPressed ? "60" : undefined}
                                >
                                    {isShowingAll ? "See less..." : "See more..."}
                                </Box>
                            </FocusRing>
                        </Box>
                    </>
                )}
            </Box>
        </Box>
    );
}
