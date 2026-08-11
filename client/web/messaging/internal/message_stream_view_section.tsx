import {Node} from "prosemirror-model";
import {Memo, ReactNode, Ref} from "react";
import {useStateWithDependenciesWithoutDispatch} from "~/client/web/helpers/lifecycle/use_state_with_dependencies.js";
import {getSpacingBetweenBlockNodes} from "~/client/web/messaging/internal/get_spacing_between_block_nodes.js";
import {MessageStreamViewContentPart} from "~/client/web/messaging/internal/message_stream_view_content_part.js";
import {MessageStreamViewThinkingProgressDefaultSummary} from "~/client/web/messaging/internal/message_stream_view_thinking_progress_default_summary.js";
import {MessageStreamViewThinkingSummary} from "~/client/web/messaging/internal/message_stream_view_thinking_summary.js";
import {postContentViewFooterHeight} from "~/client/web/styles/forum_shared_styles.js";
import {contentStyles, sprinkles, waveAnimationClassName} from "~/client/web/styles/styles.js";
import {ContentBlockNodeTypeName} from "~/shared/content/content_node_type_name.js";
import {MessageContentWithReferences} from "~/shared/content/message_content_schema.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {MessageModel, OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {
    MessageStreamContentPartPayload,
    MessageStreamPartPayload,
} from "~/shared/messaging/message_schema.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

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

export type MessageStreamSection = {
    readonly posAttributeOffset: number;
    readonly startTime: Date;
    readonly nonContentParts: ReadonlyArray<
        Exclude<MessageStreamPartPayload, {type: "Content" | "ExperimentalApprovals"}>
    >;
    readonly contentStartTime: Date | null;
    readonly contentParts: ReadonlyArray<MessageStreamContentPartPayload>;
};

export function MessageStreamViewSection({
    message,
    content,
    streamCompletedTime,
    withUserSelectNone,
    getClipboardSerializerAuthorPrefix,
    jumpAnimation,
    orderedListItemNumberByNode,
    section,
    isFirstSection,
    isLastSection,
    isLastContentSection,
    previousSectionLastBlockNodeTypeName,
    expandedRef,
    isExpanded,
    onToggleIsExpanded,
    reactionsByPos,
    shouldShowQuickReactionOnLastStreamPart,
    isReadOnly,
    onSetReaction,
    onDeleteReaction,
    onPressSeeReactions,
}: {
    message: MessageModel<string> | OptimisticMessageModel;
    content: MessageContentWithReferences;
    streamCompletedTime: Date | null;
    withUserSelectNone: boolean;
    getClipboardSerializerAuthorPrefix: Memo<() => AccountModel | null>;
    jumpAnimation: Memo<{from: number | null; to: number | null; startTime: Date}> | null;
    orderedListItemNumberByNode: ReadonlyMap<Node, number>;
    section: MessageStreamSection;
    isFirstSection: boolean;
    isLastSection: boolean;
    isLastContentSection: boolean;
    previousSectionLastBlockNodeTypeName: ContentBlockNodeTypeName | null;
    expandedRef: Ref<HTMLDivElement | null>;
    isExpanded: boolean;
    onToggleIsExpanded: () => void;
    reactionsByPos: ReadonlyMap<number, ReactionSet>;
    shouldShowQuickReactionOnLastStreamPart: boolean;
    isReadOnly: boolean;
    onSetReaction: (pos: number, reaction: Reaction | "GenericLike") => void;
    onDeleteReaction: (pos: number) => void;
    onPressSeeReactions: (pos: number) => Promise<void>;
}) {
    const children: Array<ReactNode> = [];

    let posAttributeOffset = section.posAttributeOffset;
    let previousBlockNodeTypeName: ContentBlockNodeTypeName | null = null;

    const shouldShowThinkingProgressDefaultSummary =
        isLastSection && section.contentParts.length > 0 && streamCompletedTime === null;

    const shouldShowQuickReactionAfterStreamCompleted = useStateWithDependenciesWithoutDispatch(
        (
            dependencies,
            previousShouldShowQuickReactionAfterStreamCompleted,
            previousDependencies,
        ): boolean => {
            // Once true, this flag stays true for the rest of the component's life.
            if (previousShouldShowQuickReactionAfterStreamCompleted) return true;

            // Initialize to false.
            if (previousDependencies === undefined) return false;

            const [previousShouldShowThinkingProgressDefaultSummary, previousStreamCompletedTime] =
                previousDependencies;

            // Switch this to true when the stream completes and we were previously showing the
            // thinking progress default summary.
            if (
                streamCompletedTime !== null &&
                previousStreamCompletedTime === null &&
                previousShouldShowThinkingProgressDefaultSummary
            ) {
                return true;
            }

            return false;
        },
        [shouldShowThinkingProgressDefaultSummary, streamCompletedTime],
    );

    const shouldShowQuickReaction =
        // Show quick reaction if it was requested by the parent component, we're the last
        // section, and the stream has completed.
        (shouldShowQuickReactionOnLastStreamPart &&
            isLastContentSection &&
            streamCompletedTime !== null) ||
        // Always show the quick reaction section if we were previously showing the
        // thinking progress default summary. That way layout doesn't shift when the stream
        // completes!
        shouldShowQuickReactionAfterStreamCompleted;

    for (let i = 0; i < section.contentParts.length; i++) {
        const part = section.contentParts[i]!;

        children.push(
            <MessageStreamViewContentPart
                key={i}
                message={message}
                doc={part.content}
                references={content.references}
                posAttributeOffset={posAttributeOffset}
                orderedListItemNumberByNode={orderedListItemNumberByNode}
                withUserSelectNone={withUserSelectNone}
                getClipboardSerializerAuthorPrefix={
                    isFirstSection && i === 0 ? getClipboardSerializerAuthorPrefix : undefined
                }
                jumpAnimation={jumpAnimation}
                previousBlockNodeTypeName={previousBlockNodeTypeName}
                shouldShowQuickReaction={
                    shouldShowQuickReaction && i === section.contentParts.length - 1
                }
                reactionsByPos={reactionsByPos}
                isReadOnly={isReadOnly}
                onSetReaction={onSetReaction}
                onDeleteReaction={onDeleteReaction}
                onPressSeeReactions={onPressSeeReactions}
            />,
        );

        posAttributeOffset += part.content.content.size;
        previousBlockNodeTypeName = part.content.lastChild!.type.name as ContentBlockNodeTypeName;
    }

    return (
        <>
            {!isFirstSection && (
                <div
                    style={{
                        height: spacing[
                            getSpacingBetweenBlockNodes({
                                currentBlockNodeTypeName:
                                    section.nonContentParts.length > 0
                                        ? "paragraph"
                                        : (section.contentParts[0]!.content.firstChild!.type
                                              .name as ContentBlockNodeTypeName),
                                previousBlockNodeTypeName: previousSectionLastBlockNodeTypeName,
                                previousHasReactions: reactionsByPos.has(
                                    section.posAttributeOffset,
                                ),
                                // If `space` is `null` that's because `previousSectionLastBlockNodeTypeName` was
                                // null which means the previous section ended with a thinking summary. Use
                                // paragraph margin in that case.
                            }) ?? contentStyles.paragraphMargin
                        ],
                    }}
                />
            )}
            <MessageStreamViewThinkingSummary
                content={content}
                streamCompletedTime={streamCompletedTime}
                section={section}
                expandedRef={expandedRef}
                isExpanded={isExpanded}
                onToggleIsExpanded={onToggleIsExpanded}
            />
            {children}
            {shouldShowThinkingProgressDefaultSummary && (
                <div
                    className={sprinkles({
                        position: "relative",
                        color: "grey-70",
                        fontSize: contentStyles.paragraphActualFontSize,
                        // IMPORTANT: This is the same height as `<ContentViewReactionParty>`! When we're
                        // done with the thinking summary we'll render a quick reaction. The quick reaction
                        // should be the same height so we don't end up shifting layout if there are other
                        // messages beneath us.
                        height: postContentViewFooterHeight,
                    })}
                    style={{
                        lineHeight: contentStyles.paragraphLineHeightVar,
                        // Very subtle, but we decrease the font weight from the body weight 400 to
                        // differentiate the thinking summary from body text.
                        fontWeight: 375,
                    }}
                >
                    <div
                        className={sprinkles({
                            // Absolutely positioned so the content within can grow a little larger than
                            // `postContentViewFooterHeight` without changing the element's layout. The element
                            // must be `postContentViewFooterHeight` so when it's swapped with a reaction party
                            // everything looks right.
                            position: "absolute",
                            top: "0",
                            left: "0",
                            right: "0",
                        })}
                    >
                        <div
                            style={{
                                height: spacing[
                                    getSpacingBetweenBlockNodes({
                                        // Treat thinking summary like a paragraph.
                                        currentBlockNodeTypeName: "paragraph",
                                        previousBlockNodeTypeName,
                                        // We don't allow adding reactions to the last part of a message stream before the
                                        // stream has completed. So there should never be reactions in the previous content
                                        // part.
                                        previousHasReactions: false,
                                    }) ?? contentStyles.paragraphMargin
                                ],
                            }}
                        />
                        <span className={waveAnimationClassName}>
                            <MessageStreamViewThinkingProgressDefaultSummary />
                        </span>
                    </div>
                </div>
            )}
        </>
    );
}
