import {assignInlineVars} from "@vanilla-extract/dynamic";
import nlp from "compromise";
import {
    BookOpen,
    CheckCircle,
    Globe,
    IconProps,
    MagnifyingGlass,
    PencilSimple,
    SpinnerGap,
} from "phosphor-react";
import {Node} from "prosemirror-model";
import {ComponentType, Ref, useMemo} from "react";
import {useAccountRegistry} from "~/client/web/accounts/account_registry_context.js";
import {useFileRegistry} from "~/client/web/content/file_registry_context.js";
import {printContentSingleLineTextSnippetForClient} from "~/client/web/content/print_content_single_line_text_snippet_for_client.js";
import {useStore} from "~/client/web/helpers/use_store.js";
import {MessageStreamViewNonContentPart} from "~/client/web/messaging/internal/message_stream_view_non_content_part.js";
import {MessageStreamViewThinkingProgressDefaultSummary} from "~/client/web/messaging/internal/message_stream_view_thinking_progress_default_summary.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {useSearchEntityRegistry} from "~/client/web/search/core/search_entity_registry_context.js";
import {
    backgroundColorVar,
    colorSchemeVars,
    contentStyles,
    pulseAnimationClassName,
    spinAnimationClassName,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {cutContent} from "~/shared/content/cut_content.js";
import {getContentSnippetPos} from "~/shared/content/get_content_snippet.js";
import {MessageContentWithReferences} from "~/shared/content/message_content_schema.js";
import {listItemIndentationVar} from "~/shared/design/core/constant_class_names.js";
import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {convertRemLengthToPx, spacing, subtractRemLengths} from "~/shared/design/core/spacing.js";
import {
    MessageStreamPartPayload,
    MessageStreamToolCallPartPayloadCall,
} from "~/shared/messaging/message_schema.js";
import {computeStore} from "~/shared/store/compute_store.js";

// NOTE(calebmer): You are not allowed to use the `<Box>` component in this
// file. It is critical for scroll performance that this component renders
// fast. Manually use the `sprinkles()` function instead. This reduces the
// number of fibers React needs to render. One day we'd like to introduce
// transformations that automatically inline `<Box>` components and
// `sprinkles()` functions at which point using `<Box>` would not make a
// performance difference.
//
// Assign a variable to null so you get a TypeScript error if you try to
// use `<Box>`.
//
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Box = null;

export function MessageStreamViewThinkingExpanded({
    ref,
    nonContentParts,
    content,
    thinkingEndTime,
}: {
    ref: Ref<HTMLDivElement | null>;
    nonContentParts: ReadonlyArray<
        Exclude<MessageStreamPartPayload, {type: "Content" | "ExperimentalApprovals"}>
    >;
    content: MessageContentWithReferences;
    thinkingEndTime: Date | null;
}) {
    return (
        <div
            ref={ref}
            className={sprinkles({
                paddingTop: contentStyles.standaloneBlockMargin,
                userSelect: "text",
            })}
            style={{
                paddingBottom: subtractRemLengths(
                    contentStyles.standaloneBlockMargin,
                    contentStyles.paragraphMargin,
                ),
            }}
        >
            {nonContentParts.map((part, index) => (
                <MessageStreamViewThinkingExpandedItem
                    key={index}
                    references={content.references}
                    part={part}
                    isFirstItem={index === 0}
                    isLastItem={false}
                />
            ))}
            <MessageStreamViewThinkingExpandedItem
                references={content.references}
                part={thinkingEndTime ? {type: "Done"} : {type: "Thinking"}}
                isFirstItem={false}
                isLastItem={true}
            />
        </div>
    );
}

function MessageStreamViewThinkingExpandedItem({
    references,
    part,
    isFirstItem,
    isLastItem,
}: {
    references: ContentReferences;
    part:
        | Exclude<MessageStreamPartPayload, {type: "Content" | "ExperimentalApprovals"}>
        | {type: "Done"}
        | {type: "Thinking"};
    isFirstItem: boolean;
    isLastItem: boolean;
}) {
    const spacingScale = useSpacingScale();

    let IconComponent: ComponentType<IconProps> | null = null;

    switch (part.type) {
        case "Done": {
            IconComponent = CheckCircle;
            break;
        }
        case "Thinking": {
            IconComponent = SpinnerGap;
            break;
        }
        case "ToolCall": {
            IconComponent = getIconComponentForToolCallAnnotations(part.call.annotations);
            break;
        }
    }

    const lineHeight = 1.3;

    const bulletTop =
        (fontSizesBySpacingScale[contentStyles.paragraphActualFontSize][spacingScale].fontSize *
            lineHeight -
            convertRemLengthToPx(contentStyles.unorderedListItemBulletSize, spacingScale)) /
        2;

    return (
        <div className={sprinkles({display: "flex"})}>
            <div
                className={sprinkles({
                    position: "relative",
                    zIndex: "0",
                    flexShrink: "0",
                    alignSelf: "stretch",
                    width: contentStyles.listItemIndentation,
                })}
                style={assignInlineVars({[listItemIndentationVar]: "0"})}
            >
                {IconComponent ? (
                    <div
                        className={sprinkles({
                            position: "absolute",
                            zIndex: "10",
                            width: contentStyles.listItemIndentation,
                            display: "flex",
                            alignItems: "center",
                            justifyContent: "center",
                        })}
                        style={{
                            height: contentStyles.paragraphLineHeightVar,
                        }}
                    >
                        <div
                            className={sprinkles({
                                backgroundColor: "grey-0",
                                borderRadius: "full",
                                width: "4",
                                height: "4",
                                display: "flex",
                                alignItems: "center",
                                justifyContent: "center",
                            })}
                        >
                            <IconComponent
                                size={spacing["3"]}
                                weight="bold"
                                color={colorSchemeVars["grey-70"]}
                                className={
                                    part.type === "Thinking" ? spinAnimationClassName : undefined
                                }
                            />
                        </div>
                    </div>
                ) : (
                    <div
                        className={sprinkles({
                            position: "absolute",
                            zIndex: "10",
                            width: contentStyles.unorderedListItemBulletSize,
                            height: contentStyles.unorderedListItemBulletSize,
                            borderRadius: "full",
                        })}
                        style={{
                            top: bulletTop,
                            left: contentStyles.unorderedListItemBulletLeft,
                            backgroundColor: backgroundColorVar,
                            boxShadow: `0 0 0 calc(2px - 0.0625rem) ${backgroundColorVar}`,
                            padding: "0.0625rem",
                        }}
                    >
                        <div
                            className={sprinkles({
                                width: "full",
                                height: "full",
                                borderRadius: "full",
                                backgroundColor: "grey-70",
                            })}
                        />
                    </div>
                )}
                <div
                    className={sprinkles({
                        position: "absolute",
                        zIndex: "0",
                        width: contentStyles.unorderedListItemBulletSize,
                        display: "flex",
                        justifyContent: "center",
                    })}
                    style={{
                        top: isFirstItem
                            ? bulletTop +
                              convertRemLengthToPx(
                                  contentStyles.unorderedListItemBulletSize,
                                  spacingScale,
                              ) /
                                  2
                            : 0,
                        bottom: isLastItem
                            ? bulletTop +
                              convertRemLengthToPx(
                                  contentStyles.unorderedListItemBulletSize,
                                  spacingScale,
                              ) /
                                  2
                            : 0,
                        left: contentStyles.unorderedListItemBulletLeft,
                    }}
                >
                    <div
                        className={sprinkles({
                            width: "border-thick",
                            height: "full",
                            backgroundColor: "grey-5",
                        })}
                    />
                </div>
            </div>
            <div
                className={sprinkles({
                    flexGrow: "1",
                    paddingBottom: !isLastItem ? contentStyles.standaloneBlockMargin : undefined,
                })}
            >
                {part.type === "Done" ? (
                    <div style={{lineHeight}}>Done</div>
                ) : part.type === "Thinking" ? (
                    <div className={pulseAnimationClassName} style={{lineHeight}}>
                        <MessageStreamViewThinkingProgressDefaultSummary />
                    </div>
                ) : (
                    <div style={{lineHeight}}>
                        <MessageStreamViewNonContentPart
                            references={references}
                            part={part}
                            areLinksInert={false}
                        />
                    </div>
                )}
                {part.type === "Reasoning" && (
                    <MessageStreamSectionThinkingExpandedItemReasoningContent
                        references={references}
                        content={part.content}
                    />
                )}
            </div>
        </div>
    );
}

function MessageStreamSectionThinkingExpandedItemReasoningContent({
    references,
    content,
}: {
    references: ContentReferences;
    content: Node;
}) {
    const accountRegistry = useAccountRegistry();
    const searchEntityRegistry = useSearchEntityRegistry();
    const fileRegistry = useFileRegistry();

    const remainingContentSnippetText = useStore(
        useMemo(() => {
            return computeStore(get => {
                // Get only the first line of the reasoning content. 0 gets no lines after the
                // start so only the single line of text at the start.
                //
                // Same cut used by `renderMessageStreamNonContentPart()`. We want to get the
                // remaining content after the first line here in this component.
                const {from, to} = getContentSnippetPos(content.resolve(0), 0, {
                    // Keep the title short! ~1.8 lines of text in practice it seems
                    maxLineGraphemeCount: 144,
                });

                const contentSnippet = cutContent(content, from, to);

                const contentSnippetText = printContentSingleLineTextSnippetForClient(
                    get,
                    {doc: contentSnippet, references},
                    {accountRegistry, searchEntityRegistry, fileRegistry},
                );

                // The reasoning title truncates after the first sentence, so include any remaining
                // content from the `getContentSnippetPos()` call in the remaining content body.
                const contentSnippetTextAfterFirstSentence = nlp(contentSnippetText)
                    .fullSentences()
                    .slice(1)
                    .text()
                    .trim();

                const remainingContentSnippet = cutContent(content, to);

                const remainingContentSnippetText = printContentSingleLineTextSnippetForClient(
                    get,
                    {doc: remainingContentSnippet, references},
                    {accountRegistry, searchEntityRegistry, fileRegistry},
                );

                return contentSnippetTextAfterFirstSentence + remainingContentSnippetText;
            });
        }, [accountRegistry, content, fileRegistry, references, searchEntityRegistry]),
    );

    return (
        <div className={sprinkles({paddingTop: "1", fontSize: "75", color: "grey-50"})}>
            {remainingContentSnippetText}
        </div>
    );
}

function getIconComponentForToolCallAnnotations(
    annotations: MessageStreamToolCallPartPayloadCall["annotations"],
): ComponentType<IconProps> | null {
    if (!annotations) return null;

    // Read icons!
    if (annotations.readOnlyHint) {
        if (annotations.openWorldHint) return Globe;

        if (annotations.title?.match(RegExp(/^Search/i))) return MagnifyingGlass;

        // Default to the read icon.
        return BookOpen;
    }

    // Readonly is false, so it mutated data in some way.
    return PencilSimple;
}
