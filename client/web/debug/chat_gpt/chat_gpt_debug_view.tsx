import OpenAi from "openai";
import {useCallback, useMemo, useRef, useState} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {backgroundColorVar, colorSchemeVars} from "~/client/web/styles/styles.js";
import {ChatGptConversationItem} from "~/shared/debug/chat_gpt/chat_gpt_conversation_item.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";

export function ChatGptDebugView({items}: {items: ReadonlyArray<ChatGptConversationItem>}) {
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
                    // Use `box-shadow` so it doesn't contribute to the carefully aligned monospace
                    // layout.
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
                                        // Truncate the `call_id` to 1/4th the actual size. That should be enough entropy
                                        // to identify different calls within a single conversation.
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

                // Use `box-shadow` so it doesn't contribute to the carefully aligned monospace
                // layout.
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
