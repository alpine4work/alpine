import {Node} from "prosemirror-model";
import {Memo, ReactNode, RefObject, createRef, useMemo, useRef, useState} from "react";
import {flushNavigationBarScrollEventEmitter} from "~/client/web/design/navigation_bar_helpers.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {
    MessageStreamApprovalSessionNoun,
    MessageStreamViewApprovals,
    PutMessageStreamApprovalDecisionsFunction,
} from "~/client/web/messaging/internal/message_stream_view_approvals.js";
import {
    MessageStreamSection,
    MessageStreamViewSection,
} from "~/client/web/messaging/internal/message_stream_view_section.js";
import {getScrollToNewMessagesMargin} from "~/client/web/messaging/use_scroll_to_new_messages.js";
import {getSpacingScaleWithoutListening} from "~/client/web/remix/spacing_scale_context.js";
import {actuallyComputeContentOrderedListItemNumbers} from "~/shared/content/compute_content_ordered_list_item_numbers.js";
import {ContentBlockNodeTypeName} from "~/shared/content/content_node_type_name.js";
import {isContentBodyEmpty} from "~/shared/content/is_content_empty.js";
import {MessageContentWithReferences} from "~/shared/content/message_content_schema.js";
import {convertRemLengthToPx} from "~/shared/design/core/spacing.js";
import {scheduleMicrotask} from "~/shared/helpers/async/schedule_microtask.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {LazyMap} from "~/shared/helpers/control/lazy_map.js";
import {emptySet} from "~/shared/helpers/set/empty_set.open_source.js";
import {MessageModel, OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {
    MessageStream,
    MessageStreamContentPartPayload,
    MessageStreamExperimentalApprovalsPartPayload,
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

// TODO(calebmer, #ai-realtime-hacks): I haven't implemented backfilling for
// message streams. That means a user could load the page when there's an active
// stream and they'll load the current stream parts from the server but miss some
// realtime events that happen between the Remix `loader()` call and when we
// connect to a messaging realtime WebSocket. Or they'll miss realtime events if
// they go temporarily offline.
//
// My proposal for backfill is to initiate backfill in this component. (So we only
// backfill message streams that are rendered.) And pass the list of parts plus the
// parts versions, compare that to what's on the server, and return any new parts.
//
// I haven't implemented backfilling since I'm moving fast today to get this
// shipped.
export function MessageStreamView({
    message,
    isLastMessage,
    content,
    stream,
    withUserSelectNone,
    getClipboardSerializerAuthorPrefix,
    jumpAnimation,
    approvalSessionNoun,
    putApprovalDecisions,
    reactionsByPos,
    shouldShowQuickReactionOnLastStreamPart,
    isReadOnly,
    onSetReaction,
    onDeleteReaction,
    onPressSeeReactions,
}: {
    message: MessageModel<string> | OptimisticMessageModel;
    isLastMessage: boolean;
    content: MessageContentWithReferences;
    stream: MessageStream;
    withUserSelectNone: boolean;
    getClipboardSerializerAuthorPrefix: Memo<() => AccountModel | null>;
    jumpAnimation: Memo<{from: number | null; to: number | null; startTime: Date}> | null;
    approvalSessionNoun: MessageStreamApprovalSessionNoun;
    putApprovalDecisions: Memo<PutMessageStreamApprovalDecisionsFunction> | null;
    reactionsByPos: ReadonlyMap<number, ReactionSet>;
    shouldShowQuickReactionOnLastStreamPart: boolean;
    isReadOnly: boolean;
    onSetReaction: (pos: number, reaction: Reaction | "GenericLike") => void;
    onDeleteReaction: (pos: number) => void;
    onPressSeeReactions: (pos: number) => Promise<void>;
}) {
    const orderedListItemNumberByNode = useMemo(() => {
        const orderedListItemNumberByNode = new Map<Node, number>();

        actuallyComputeContentOrderedListItemNumbers(orderedListItemNumberByNode, callback => {
            content.doc.forEach(callback);

            for (const part of stream.parts) {
                if (part.payload.type === "Content") {
                    part.payload.content.forEach(callback);
                }
            }
        });

        return orderedListItemNumberByNode;
    }, [content.doc, stream.parts]);

    const sections: ReadonlyArray<MessageStreamSection> = useMemo(() => {
        const sections: Array<MessageStreamSection> = [];

        let posAttributeOffset = 0;

        let currentSection: {
            posAttributeOffset: number;
            startTime: Date;
            nonContentParts: Array<
                Exclude<MessageStreamPartPayload, {type: "Content" | "ExperimentalApprovals"}>
            >;
            contentStartTime: Date | null;
            contentParts: Array<MessageStreamContentPartPayload>;
        } = {
            posAttributeOffset,
            startTime: message.createdTime,
            nonContentParts: [],
            contentStartTime: null,
            contentParts: [],
        };

        if (!isContentBodyEmpty(content.doc)) {
            posAttributeOffset += content.doc.content.size;
            currentSection.contentStartTime ??= message.createdTime;
            currentSection.contentParts.push({type: "Content", content: content.doc});
        }

        for (const part of stream.parts) {
            // Approvals don't render inline with the stream's thinking sections. They render
            // as interactive cards at the bottom of the message instead.
            if (part.payload.type === "ExperimentalApprovals") continue;

            if (part.payload.type === "Content") {
                posAttributeOffset += part.payload.content.content.size;
                currentSection.contentStartTime ??= part.createdTime;
                currentSection.contentParts.push(part.payload);
                continue;
            }

            // If there are content parts before this non-content part then create a new
            // section. Non-content parts are collapsed until expanded.
            if (currentSection.contentParts.length > 0) {
                sections.push(currentSection);

                // NOTE(ifitzsimmons, 2026-01-02): As stated above, we create a new "thinking
                // summary" section for each content part produced by the agent. This is intuitive
                // because it resembles the way humans interact -- we (hopefully) think before we
                // say something.
                //
                // So, when a new section is created, it is due to one of two scenarios:
                //
                // 1. The agent completes a "thought", writes a response, and moves on to the next
                //    "thought". This is pretty unlikely in the context of the way our agents work
                //    today, but that might not always be the case.
                // 2. WE inject some system message(s) that is not part of the agent's response.
                //    For example, we might inject a message at the top of the response that let's
                //    the user know that they are almost out of tokens.
                //
                // In either case, it's not quite accurate to measure the following section's start
                // time by using the first content part's created time. Consider the case where we
                // inject the system message before the agent does any work
                //
                // 1. We send a system message.
                // 2. The agent starts handling the request.
                // 3. At some point later, the agent returns a reasoning or tool call part.
                //
                // In the above example, the following section's start time is actually number 2 in
                // the list. We may not get the first reasoning summary until 30 seconds later.
                // Number 1 (system message sent) is almost _always_ closer to the actual start
                // time (Number 2) than the first reasoning summary part (Number 3).
                //
                // If it helps to see a real world example of why this is necessary, see the
                // following bug [1]. The second "Though for 0 seconds" summary is incorrect (the
                // first one is a separate bug that's already been fixed).
                //
                // [1]:
                //     https://alpine.inc/s/c2pwxmpv3z7b3db19tsn6y1qfg/tasks/ce6enwqth1qzsx9snntsc8gtbg
                const approximatePreviousSectionEndTime = currentSection.contentStartTime;

                currentSection = {
                    posAttributeOffset,
                    startTime: approximatePreviousSectionEndTime ?? part.createdTime,
                    nonContentParts: [],
                    contentStartTime: null,
                    contentParts: [],
                };
            }

            currentSection.nonContentParts.push(part.payload);
        }

        sections.push(currentSection);

        return sections;
    }, [content.doc, message.createdTime, stream.parts]);

    const [originalExpandedSectionIndexes, setExpandedSectionIndexes] =
        useState<ReadonlySet<number>>(emptySet);

    let expandedSectionIndexes = originalExpandedSectionIndexes;

    // Fixup state if any expanded section indexes don't have `nonContentParts`.
    for (const sectionIndex of originalExpandedSectionIndexes.keys()) {
        const section = sections[sectionIndex];

        if (!section || section.nonContentParts.length === 0) {
            const newExpandedSectionIndexes = new Set(originalExpandedSectionIndexes);
            newExpandedSectionIndexes.delete(sectionIndex);
            expandedSectionIndexes = newExpandedSectionIndexes;
        }
    }

    if (expandedSectionIndexes !== originalExpandedSectionIndexes) {
        setExpandedSectionIndexes(expandedSectionIndexes);
    }

    const [expandedRefBySectionIndex] = useState(
        () => new LazyMap<number, RefObject<HTMLDivElement | null>>(() => createRef()),
    );

    const approvalPart = useMemo(() => {
        const approvalParts = stream.parts.filter(
            (
                part,
            ): part is {
                version: number;
                payload: MessageStreamExperimentalApprovalsPartPayload;
                createdTime: Date;
            } => part.payload.type === "ExperimentalApprovals",
        );

        if (approvalParts.length === 0) return null;

        // An approval part completes the stream, so there can't be more than one.
        assert(approvalParts.length === 1);
        return assertExists(approvalParts[0]);
    }, [stream.parts]);

    const children: Array<ReactNode> = [];
    let lastContentSectionIndex = -1;

    for (let i = sections.length - 1; i >= 0; i--) {
        if (sections[i]!.contentParts.length === 0) continue;
        lastContentSectionIndex = i;
        break;
    }

    let previousSectionLastBlockNodeTypeName: ContentBlockNodeTypeName | null = null;

    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
        const section = sections[sectionIndex]!;

        children.push(
            <MessageStreamViewSection
                key={sectionIndex}
                message={message}
                content={content}
                streamCompletedTime={stream.completedTime}
                withUserSelectNone={withUserSelectNone}
                getClipboardSerializerAuthorPrefix={getClipboardSerializerAuthorPrefix}
                jumpAnimation={jumpAnimation}
                orderedListItemNumberByNode={orderedListItemNumberByNode}
                section={section}
                isFirstSection={sectionIndex === 0}
                isLastSection={sectionIndex === sections.length - 1}
                isLastContentSection={sectionIndex === lastContentSectionIndex}
                previousSectionLastBlockNodeTypeName={previousSectionLastBlockNodeTypeName}
                expandedRef={expandedRefBySectionIndex.get(sectionIndex)}
                isExpanded={expandedSectionIndexes.has(sectionIndex)}
                onToggleIsExpanded={() => {
                    setExpandedSectionIndexes(oldExpandedSectionIndexes => {
                        const newExpandedSectionIndexes = new Set(oldExpandedSectionIndexes);
                        if (newExpandedSectionIndexes.has(sectionIndex)) {
                            newExpandedSectionIndexes.delete(sectionIndex);
                        } else {
                            newExpandedSectionIndexes.add(sectionIndex);
                        }
                        return newExpandedSectionIndexes;
                    });
                }}
                reactionsByPos={reactionsByPos}
                shouldShowQuickReactionOnLastStreamPart={
                    shouldShowQuickReactionOnLastStreamPart && approvalPart === null
                }
                isReadOnly={isReadOnly}
                onSetReaction={onSetReaction}
                onDeleteReaction={onDeleteReaction}
                onPressSeeReactions={onPressSeeReactions}
            />,
        );

        previousSectionLastBlockNodeTypeName =
            section.contentParts.length > 0
                ? (section.contentParts[section.contentParts.length - 1]!.content.lastChild!.type
                      .name as ContentBlockNodeTypeName)
                : null;
    }

    const containerRef = useRef<HTMLDivElement>(null);
    const lastStreamRef = useRef<MessageStream>(stream);
    const lastExpandedSectionIndexesRef = useRef<ReadonlySet<number>>(expandedSectionIndexes);
    const previousStreamHeightRef = useRef(0);
    const previousLastExpandedSectionHeightRef = useRef(0);
    const autoScrollStateRef = useRef<"Stopped" | "Wheeled" | null>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        // Run this effect whenever the stream changes.
        if (
            lastStreamRef.current === stream &&
            lastExpandedSectionIndexesRef.current === expandedSectionIndexes
        ) {
            return;
        }
        lastStreamRef.current = stream;
        lastExpandedSectionIndexesRef.current = expandedSectionIndexes;

        // Only scroll if this is the last message in the message list.
        if (!isLastMessage) return;

        const containerElement = assertExists(containerRef.current);
        const scrollElement = findScrollElement(containerElement);
        if (!scrollElement) return;

        const streamHeight = containerElement.clientHeight;
        const previousStreamHeight = previousStreamHeightRef.current;

        // Don't scroll if the stream shrunk.
        if (streamHeight <= previousStreamHeight) return;

        previousStreamHeightRef.current = streamHeight;

        const lastExpandedSectionHeight =
            expandedRefBySectionIndex.get(sections.length - 1)?.current?.clientHeight ?? 0;
        const previousLastExpandedSectionHeight = previousLastExpandedSectionHeightRef.current;
        previousLastExpandedSectionHeightRef.current = lastExpandedSectionHeight;

        let hasAddedHandleWheelListener = false;

        const handleWheel = () => {
            if (autoScrollStateRef.current === "Stopped") {
                autoScrollStateRef.current = "Wheeled";
                scrollElement.removeEventListener("wheel", handleWheel);
            }
        };

        if (autoScrollStateRef.current === "Stopped") {
            hasAddedHandleWheelListener = true;
            scrollElement.addEventListener("wheel", handleWheel);
        }

        const run = () => {
            const spacingScale = getSpacingScaleWithoutListening();

            let scrollDelta: number;
            const streamHeightDelta = streamHeight - previousStreamHeight;

            const heightLimit = convertRemLengthToPx("128", spacingScale);

            // After the stream content exceeds a certain height, stop scrolling to the bottom
            // whenever the stream changes. So we scroll in a bunch of content on screen then
            // stop to let the user read the content.
            //
            // A couple details:
            //
            // 1. If the thinking summary has been expanded then we don't count it as a part of
            //    the stream's height (why we subtract `previousLastExpandedSectionHeight`).
            //    This means we always scroll to bottom when there are new thinking summary
            //    parts. Thinking summary parts are added at a much slower rate. If the user
            //    has expanded the thinking summary then we want to show them each new thinking
            //    summary item.
            //
            // 2. If we've stopped scrolling because we've exceeded a certain height then the
            //    user uses their scroll wheel to move to the bottom of the stream again we'll
            //    permanently auto-scroll for the rest of the message. This is what
            //    `autoScrollStateRef.current` does.
            if (
                autoScrollStateRef.current !== "Wheeled" &&
                streamHeight - lastExpandedSectionHeight > heightLimit
            ) {
                autoScrollStateRef.current = "Stopped";

                if (!hasAddedHandleWheelListener) {
                    hasAddedHandleWheelListener = true;
                    scrollElement.addEventListener("wheel", handleWheel);
                }

                // Scroll to reach `heightLimit` based on stream height from the previous render.
                scrollDelta = Math.max(
                    0,
                    heightLimit - (previousStreamHeight - previousLastExpandedSectionHeight),
                );
            } else {
                scrollDelta =
                    scrollElement.scrollHeight -
                    scrollElement.clientHeight -
                    scrollElement.scrollTop;
            }

            // Only scroll if we're near the bottom. If we'd have to scroll more than ~4
            // message views then don't do it since messages would jump unexpectedly and the
            // user might be disturbed while reading.
            if (scrollDelta <= streamHeightDelta + getScrollToNewMessagesMargin(spacingScale)) {
                scrollElement.scrollTop += scrollDelta;
                flushNavigationBarScrollEventEmitter.emit(scrollElement);
            }
        };

        // Run our effect after a microtask so the parent `<VirtualizedScrollView>` has a
        // chance to re-render and update our positions.
        let isCancelled = false;

        // If auto-scroll has been stopped then don't scroll.
        if (autoScrollStateRef.current !== "Stopped") {
            scheduleMicrotask(() => {
                if (isCancelled) return;
                run();
            });
        }

        return () => {
            isCancelled = true;

            if (hasAddedHandleWheelListener) {
                scrollElement.removeEventListener("wheel", handleWheel);
            }
        };
    }, [expandedRefBySectionIndex, expandedSectionIndexes, isLastMessage, sections.length, stream]);

    return (
        <div ref={containerRef}>
            {children}
            {approvalPart && (
                <MessageStreamViewApprovals
                    part={approvalPart.payload}
                    references={content.references}
                    author={message.author}
                    approvalSessionNoun={approvalSessionNoun}
                    putApprovalDecisions={putApprovalDecisions}
                    isLastMessage={isLastMessage}
                />
            )}
        </div>
    );
}

function findScrollElement(element: HTMLElement): HTMLElement | null {
    let scrollElement: HTMLElement | null = element;

    while (scrollElement) {
        const {overflowY} = getComputedStyle(scrollElement);

        const isScrollable = overflowY === "scroll" || overflowY === "auto";
        if (isScrollable) break;

        scrollElement = scrollElement.parentElement;
    }

    return scrollElement;
}
