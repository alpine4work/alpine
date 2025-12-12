import {assignInlineVars} from "@vanilla-extract/dynamic";
import {BookOpen, CheckCircle, IconProps, MagnifyingGlass, SpinnerGap} from "phosphor-react";
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
    pulseAnimationWithMoreOpacityClassName,
    spinAnimationClassName,
    sprinkles,
    waveAnimationClassName,
} from "~/client/web/styles/styles.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {cutContent} from "~/shared/content/cut_content.js";
import {getContentSnippetPos} from "~/shared/content/get_content_snippet.js";
import {listItemIndentationVar} from "~/shared/design/core/constant_class_names.js";
import {convertRemLengthToPx, spacing, subtractRemLengths} from "~/shared/design/core/spacing.js";
import {MessageContentWithReferences} from "~/shared/messaging/message_content_schema.js";
import {MessageStreamPartPayload} from "~/shared/messaging/message_schema.js";
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
    nonContentParts: ReadonlyArray<Exclude<MessageStreamPartPayload, {type: "Content"}>>;
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
        | Exclude<MessageStreamPartPayload, {type: "Content"}>
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
            switch (part.call.type) {
                case "Search": {
                    IconComponent = MagnifyingGlass;
                    break;
                }
                case "Read": {
                    IconComponent = BookOpen;
                    break;
                }
            }
            break;
        }
    }

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
                            top: contentStyles.unorderedListItemBulletTop[spacingScale],
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
                            ? contentStyles.unorderedListItemBulletTop[spacingScale] +
                              convertRemLengthToPx(
                                  contentStyles.unorderedListItemBulletSize,
                                  spacingScale,
                              ) /
                                  2
                            : 0,
                        bottom: isLastItem
                            ? contentStyles.unorderedListItemBulletTop[spacingScale] +
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
                    paddingBottom: !isLastItem ? contentStyles.standaloneBlockMargin : undefined,
                })}
            >
                {part.type === "Done" ? (
                    <div>Done</div>
                ) : part.type === "Thinking" ? (
                    <div className={waveAnimationClassName}>
                        <div className={pulseAnimationWithMoreOpacityClassName}>
                            <MessageStreamViewThinkingProgressDefaultSummary />
                        </div>
                    </div>
                ) : (
                    <MessageStreamViewNonContentPart references={references} part={part} />
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
                const {to} = getContentSnippetPos(content.resolve(0), 0);

                const remainingContentSnippet = cutContent(content, to);

                const remainingContentSnippetText = printContentSingleLineTextSnippetForClient(
                    get,
                    {doc: remainingContentSnippet, references},
                    {accountRegistry, searchEntityRegistry, fileRegistry},
                );

                return remainingContentSnippetText;
            });
        }, [accountRegistry, content, fileRegistry, references, searchEntityRegistry]),
    );

    return (
        <div className={sprinkles({paddingTop: "1", fontSize: "75", color: "grey-50"})}>
            {remainingContentSnippetText}
        </div>
    );
}
