import {Node} from "prosemirror-model";
import {Memo, useMemo, useState} from "react";
import {ContentBlockWidthContextProvider} from "~/client/web/content/content_block_width.js";
import {ContentView, ContentViewProps} from "~/client/web/content/content_view.js";
import {useReporter} from "~/client/web/design/reporter.js";
import {useStateWithDependenciesWithoutDispatch} from "~/client/web/helpers/lifecycle/use_state_with_dependencies.js";
import {ReactionButton} from "~/client/web/reactions/reaction_button.js";
import {ReactionParty} from "~/client/web/reactions/reaction_party.js";
import {
    postContentViewFooterHeight,
    postContentViewFooterReactionButtonAreaWidth,
} from "~/client/web/styles/forum_shared_styles.js";
import {contentStyles, sprinkles} from "~/client/web/styles/styles.js";
import {ContentWithReferences} from "~/shared/content/content_references.js";
import {cutContent} from "~/shared/content/cut_content.js";
import {iterableEvery} from "~/shared/helpers/iterable/iterable_every.js";
import {Reaction} from "~/shared/reactions/reaction.js";
import {ReactionSet} from "~/shared/reactions/reaction_set.js";
import {AccountModel} from "~/shared/spaces/account_model.js";

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
    getClipboardSerializerAuthorPrefix,
    jumpAnimation = null,
    reactionsByPos,
    isReadOnly,
    onSetReaction,
    onDeleteReaction,
    onPressSeeReactions,
    ...props
}: Pick<
    ContentViewProps<Content>,
    | "content"
    | "contentUpdatedTime"
    | "posAttributeOffset"
    | "getClipboardSerializerAuthorPrefix"
    | "jumpAnimation"
    | ContentViewWithReactionPartiesSupportedPropsKey
> & {
    reactionsByPos: ReadonlyMap<number, ReactionSet>;
    isReadOnly: boolean;
    onSetReaction: (pos: number | "Files", reaction: Reaction | "GenericLike") => void;
    onDeleteReaction: (pos: number | "Files") => void;
    onPressSeeReactions: (pos: number | "Files") => Promise<void>;
}) {
    // Shared ordered list item number cache for reaction party parts. Reset the
    // cache whenever the content changes.
    const orderedListItemNumberByNode = useStateWithDependenciesWithoutDispatch(
        () => new Map<Node, number>(),
        [content.doc],
    );

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
                    getClipboardSerializerAuthorPrefix={getClipboardSerializerAuthorPrefix}
                    jumpAnimation={jumpAnimation}
                    props={props}
                    partIndex={index}
                    partCount={orderedReactionsByPosEntries.length}
                    previousPos={orderedReactionsByPosEntries[index - 1]?.[0] ?? 0}
                    pos={pos}
                    reactions={reactions}
                    isReadOnly={isReadOnly}
                    onSetReaction={onSetReaction}
                    onDeleteReaction={onDeleteReaction}
                    onPressSeeReactions={onPressSeeReactions}
                    orderedListItemNumberByNode={orderedListItemNumberByNode}
                />
            ))}
        </>
    );
}

function ContentViewWithReactionPartiesPart<Content extends ContentWithReferences>({
    content,
    contentUpdatedTime,
    posAttributeOffset: originalPosAttributeOffset = 0,
    getClipboardSerializerAuthorPrefix,
    jumpAnimation: originalJumpAnimation,
    props,
    partIndex,
    partCount,
    previousPos,
    pos,
    reactions,
    isReadOnly,
    onSetReaction,
    onDeleteReaction,
    onPressSeeReactions,
    orderedListItemNumberByNode,
}: {
    content: Content;
    contentUpdatedTime: Date | null | undefined;
    posAttributeOffset: number;
    getClipboardSerializerAuthorPrefix: Memo<() => AccountModel | null> | undefined;
    jumpAnimation: Memo<{from: number | null; to: number | null; startTime: Date}> | null;
    props: Pick<ContentViewProps<Content>, ContentViewWithReactionPartiesSupportedPropsKey>;
    partIndex: number;
    partCount: number;
    previousPos: number;
    pos: number;
    reactions: ReactionSet | null;
    isReadOnly: boolean;
    onSetReaction: (pos: number | "Files", reaction: Reaction | "GenericLike") => void;
    onDeleteReaction: (pos: number | "Files") => void;
    onPressSeeReactions: (pos: number | "Files") => Promise<void>;
    orderedListItemNumberByNode: Map<Node, number>;
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
                        doc: cutContent(content.doc, previousPos, pos, orderedListItemNumberByNode),
                        references: content.references,
                    }),
                    [
                        content.doc,
                        content.references,
                        orderedListItemNumberByNode,
                        pos,
                        previousPos,
                    ],
                )}
                posAttributeOffset={posAttributeOffset}
                contentUpdatedTime={partIndex === partCount - 1 ? contentUpdatedTime : undefined}
                getClipboardSerializerAuthorPrefix={
                    partIndex === 0 ? getClipboardSerializerAuthorPrefix : undefined
                }
                jumpAnimation={jumpAnimation}
            />
            {reactions && (
                <ContentViewReactionParty
                    pos={pos}
                    reactions={reactions}
                    isReadOnly={isReadOnly}
                    onSetReaction={onSetReaction}
                    onDeleteReaction={onDeleteReaction}
                    onPressSeeReactions={onPressSeeReactions}
                    // This works well in `<MessageView>` where `data-room` and `data-index` are
                    // passed in as props. Currently this component is only used in `<MessageView>`
                    // so we don't care about finding an alternative sufficient entropy source.
                    randomSeed={`ContentView:${dataRoom}-${dataIndex}-${partIndex}`}
                    withMarginBottom={partIndex < partCount - 1}
                />
            )}
        </>
    );
}

export function ContentViewReactionParty({
    pos,
    reactions,
    isReadOnly,
    onSetReaction,
    onDeleteReaction,
    onPressSeeReactions,
    randomSeed,
    withMarginBottom = false,
}: {
    pos: number | "Files";
    reactions: ReactionSet;
    isReadOnly: boolean;
    onSetReaction: (pos: number | "Files", reaction: Reaction | "GenericLike") => void;
    onDeleteReaction: (pos: number | "Files") => void;
    onPressSeeReactions: (pos: number | "Files") => Promise<void>;
    randomSeed: string;
    withMarginBottom?: boolean;
}) {
    const reporter = useReporter();

    const [isReactionPartyPressPending, setIsReactionPartyPressPending] = useState(false);

    const hasOnlyGenericLikeReactions = useMemo(() => {
        return iterableEvery(
            reactions?.get().values() ?? [],
            reaction => reaction === "GenericLike",
        );
    }, [reactions]);

    return (
        <div
            className={sprinkles({
                height: postContentViewFooterHeight,
                marginLeft: hasOnlyGenericLikeReactions ? "-1.5" : "-1",
                marginBottom: withMarginBottom ? contentStyles.standaloneBlockMargin : undefined,
                display: "flex",
                alignItems: "center",
            })}
        >
            <ContentBlockWidthContextProvider
                maxWidth={contentStyles.contentMaxWidth}
                paddingRight={postContentViewFooterReactionButtonAreaWidth}
            >
                <ReactionParty
                    // The reaction party runs into the previous text if it's not offset
                    // a little.
                    offsetTopIfManyReactions="1.5"
                    reactions={reactions}
                    randomSeed={randomSeed}
                    onPress={() => {
                        if (isReactionPartyPressPending) return;

                        setIsReactionPartyPressPending(true);

                        onPressSeeReactions(pos).then(
                            () => {
                                setIsReactionPartyPressPending(false);
                            },
                            error => {
                                setIsReactionPartyPressPending(false);
                                reporter.displayError("Couldn\u2019t open reactions", error);
                            },
                        );
                    }}
                />
            </ContentBlockWidthContextProvider>
            <div
                className={sprinkles({
                    flexShrink: "0",
                    display: "flex",
                    justifyContent: "flex-start",
                    alignItems: "center",
                })}
                style={{width: postContentViewFooterReactionButtonAreaWidth}}
            >
                <ReactionButton
                    reactions={reactions}
                    isReadOnly={isReadOnly}
                    onSetReaction={reaction => onSetReaction(pos, reaction)}
                    onDeleteReaction={() => onDeleteReaction(pos)}
                    onPressSeeReactions={() => onPressSeeReactions(pos)}
                />
            </div>
        </div>
    );
}
