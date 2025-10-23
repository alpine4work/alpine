import {Fragment, Memo, useMemo} from "react";
import {ContentBlockWidthContextProvider} from "~/client/content/content_block_width.js";
import {ContentView, ContentViewProps} from "~/client/content/content_view.js";
import {ReactionButton} from "~/client/reactions/reaction_button.js";
import {ReactionParty} from "~/client/reactions/reaction_party.js";
import {
    postContentViewFooterHeight,
    postContentViewFooterReactionButtonAreaWidth,
} from "~/client/styles/forum_shared_styles.js";
import {contentStyles, sprinkles} from "~/client/styles/styles.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";
import {addRemLengths} from "~/shared/design/core/spacing.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";

// Allow list the props that definitely work with our reaction party rendering
// which splits up the `<ContentView>` into multiple smaller `<ContentView>`s.
type ContentViewWithReactionPartiesSupportedPropsKey =
    | "className"
    | "style"
    | "data-room"
    | "data-index"
    | "fileAttachmentTarget"
    | "withUserSelectNone";

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

export function ContentViewWithReactionParties<Content extends ContentWithReferences>({
    content,
    contentUpdatedTime,
    posAttributeOffset = 0,
    getClipboardSerializerPrefix,
    jumpAnimation = null,
    reactionsByPos,
    onSetReaction,
    onDeleteReaction,
    ...props
}: Pick<
    ContentViewProps<Content>,
    | "content"
    | "contentUpdatedTime"
    | "posAttributeOffset"
    | "getClipboardSerializerPrefix"
    | "jumpAnimation"
    | ContentViewWithReactionPartiesSupportedPropsKey
> & {
    reactionsByPos: ReadonlyMap<number, ReactionSet>;
    onSetReaction: (pos: number, reaction: Reaction | "GenericLike") => void;
    onDeleteReaction: (pos: number) => void;
}) {
    const orderedReactionsByPosEntries = useMemo(() => {
        const orderedReactionsByPosEntries: Array<[number, ReactionSet | null]> = Array.from(
            reactionsByPos,
        ).sort(([pos1], [pos2]) => pos1 - pos2);

        if (
            orderedReactionsByPosEntries.length === 0 ||
            orderedReactionsByPosEntries[orderedReactionsByPosEntries.length - 1]![0] !==
                content.doc.content.size
        ) {
            orderedReactionsByPosEntries.push([content.doc.content.size, null]);
        }

        return orderedReactionsByPosEntries;
    }, [content.doc.content.size, reactionsByPos]);

    return (
        <>
            {orderedReactionsByPosEntries.map(([pos, reactions], index) => (
                <ContentViewWithReactionPartiesPart
                    key={pos}
                    content={content}
                    contentUpdatedTime={contentUpdatedTime}
                    posAttributeOffset={posAttributeOffset}
                    getClipboardSerializerPrefix={getClipboardSerializerPrefix}
                    jumpAnimation={jumpAnimation}
                    props={props}
                    partIndex={index}
                    partCount={orderedReactionsByPosEntries.length}
                    previousPos={orderedReactionsByPosEntries[index - 1]?.[0] ?? 0}
                    pos={pos}
                    reactions={reactions}
                    onSetReaction={onSetReaction}
                    onDeleteReaction={onDeleteReaction}
                />
            ))}
        </>
    );
}

const contentBlockWidthContextPaddingLeft = addRemLengths(
    postContentViewFooterReactionButtonAreaWidth,
    "-1.5",
);

function ContentViewWithReactionPartiesPart<Content extends ContentWithReferences>({
    content,
    contentUpdatedTime,
    posAttributeOffset: originalPosAttributeOffset = 0,
    getClipboardSerializerPrefix,
    jumpAnimation: originalJumpAnimation,
    props,
    partIndex,
    partCount,
    previousPos,
    pos,
    reactions,
    onSetReaction,
    onDeleteReaction,
}: {
    content: Content;
    contentUpdatedTime: Date | null | undefined;
    posAttributeOffset: number;
    getClipboardSerializerPrefix: Memo<() => string | null> | undefined;
    jumpAnimation: Memo<{from: number | null; to: number | null; startTime: Date}> | null;
    props: Pick<ContentViewProps<Content>, ContentViewWithReactionPartiesSupportedPropsKey>;
    partIndex: number;
    partCount: number;
    previousPos: number;
    pos: number;
    reactions: ReactionSet | null;
    onSetReaction: (pos: number, reaction: Reaction | "GenericLike") => void;
    onDeleteReaction: (pos: number) => void;
}) {
    const {"data-room": dataRoom, "data-index": dataIndex} = props;

    const posAttributeOffset = originalPosAttributeOffset + previousPos;

    const jumpAnimation = useMemo(() => {
        if (!originalJumpAnimation) return null;

        const jumpAnimation = {
            from:
                originalJumpAnimation.from !== null
                    ? Math.max(0, originalJumpAnimation.from - posAttributeOffset)
                    : null,
            to:
                originalJumpAnimation.to !== null
                    ? Math.min(
                          content.doc.content.size,
                          originalJumpAnimation.to - posAttributeOffset,
                      )
                    : null,
            startTime: originalJumpAnimation.startTime,
        };

        // If after offsetting, the jump animation doesn't make sense then we don't
        // have a jump animation for this part.
        if (jumpAnimation.from !== null && jumpAnimation.from > content.doc.content.size)
            return null;
        if (jumpAnimation.to !== null && jumpAnimation.to < 0) return null;

        return jumpAnimation;
    }, [content.doc.content.size, originalJumpAnimation, posAttributeOffset]);

    return (
        <>
            <ContentView
                {...props}
                content={useMemo(
                    () => ({
                        doc: content.doc.cut(previousPos, pos),
                        references: content.references,
                    }),
                    [content.doc, content.references, pos, previousPos],
                )}
                posAttributeOffset={posAttributeOffset}
                contentUpdatedTime={partIndex === partCount - 1 ? contentUpdatedTime : undefined}
                getClipboardSerializerPrefix={
                    partIndex === 0 ? getClipboardSerializerPrefix : undefined
                }
                jumpAnimation={jumpAnimation}
            />
            {reactions && (
                <div
                    className={sprinkles({
                        height: postContentViewFooterHeight,
                        marginTop: contentStyles.paragraphMargin,
                        marginBottom:
                            partIndex < partCount - 1
                                ? contentStyles.standaloneBlockMargin
                                : undefined,
                        display: "flex",
                        alignItems: "center",
                    })}
                >
                    <div
                        className={sprinkles({
                            flexShrink: "0",
                            marginLeft: "-1.5",
                            display: "flex",
                            justifyContent: "flex-start",
                            alignItems: "center",
                        })}
                        style={{width: postContentViewFooterReactionButtonAreaWidth}}
                    >
                        <ReactionButton
                            reactions={reactions}
                            onSetReaction={reaction => onSetReaction(pos, reaction)}
                            onDeleteReaction={() => onDeleteReaction(pos)}
                        />
                    </div>
                    <ContentBlockWidthContextProvider
                        maxWidth={contentStyles.contentMaxWidth}
                        paddingLeft={contentBlockWidthContextPaddingLeft}
                    >
                        <ReactionParty
                            reactions={reactions}
                            // This works well in `<MessageView>` where `data-room` and `data-index` are
                            // passed in as props. Currently this component is only used in `<MessageView>`
                            // so we don't care about finding an alternative sufficient entropy source.
                            randomSeed={`ContentView:${dataRoom}-${dataIndex}-${partIndex}`}
                            onPress={() => {
                                // TODO(calebmer): Will be implemented later in the stack.
                            }}
                        />
                    </ContentBlockWidthContextProvider>
                </div>
            )}
        </>
    );
}
