import {Node} from "prosemirror-model";
import {Memo, ReactNode, memo, useMemo} from "react";
import {ContentView} from "~/client/content/content_view.js";
import {hasStandaloneMarginByContentBlockNodeTypeName} from "~/client/content/has_standalone_margin_by_content_block_node_type_name.js";
import {MessageStreamSummary} from "~/client/messaging/internal/message_stream_summary.js";
import {contentStyles, messagingStyles} from "~/client/styles/styles.js";
import {actuallyComputeContentOrderedListItemNumbers} from "~/shared/content/compute_content_ordered_list_item_numbers.js";
import {
    ContentBlockNodeTypeName,
    isContentListItemNodeTypeName,
} from "~/shared/content/content_node_type_name.js";
import {ContentReferences, emptyContentReferences} from "~/shared/content/content_references.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {
    MessageContent,
    MessageContentWithReferences,
} from "~/shared/messaging/message_content_schema.js";
import {MessageModel, OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {
    MessageStream,
    MessageStreamPartPayload,
    MessageStreamReasoningPartPayload,
    MessageStreamToolCallPartPayload,
} from "~/shared/messaging/message_schema.js";

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

export function MessageStreamViewItemList({
    message,
    isContentEmpty,
    content,
    stream,
    withUserSelectNone,
    getClipboardSerializerPrefix,
    jumpAnimation,
}: {
    message: MessageModel<string> | OptimisticMessageModel;
    isContentEmpty: boolean;
    content: MessageContentWithReferences;
    stream: MessageStream;
    withUserSelectNone: boolean;
    getClipboardSerializerPrefix: Memo<() => string | null>;
    jumpAnimation: Memo<{from: number | null; to: number | null; startTime: Date}> | null;
}) {
    let posAttributeOffset = 0;

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

    const children: Array<ReactNode> = [];
    let previousBlockNodeTypeName: ContentBlockNodeTypeName | null = null;

    if (!isContentEmpty) {
        children.push(
            <MessageStreamViewContentPart
                key="content"
                message={message}
                doc={content.doc}
                references={content.references}
                posAttributeOffset={posAttributeOffset}
                orderedListItemNumberByNode={orderedListItemNumberByNode}
                withUserSelectNone={withUserSelectNone}
                getClipboardSerializerPrefix={getClipboardSerializerPrefix}
                jumpAnimation={jumpAnimation}
            />,
        );

        posAttributeOffset += content.doc.content.size;
        previousBlockNodeTypeName = content.doc.lastChild!.type.name as ContentBlockNodeTypeName;
    }

    // NOTE(ifitzsimmons, 2025-11-11): When rendering Agent messages, we have two general types of
    // content:
    // 1. content sections (agent response)
    // 2. thinking sections (tool call, reasoning, etc.)
    //
    // Content sections are pretty straight forward and are rendered as normal content (like a
    // message from another human).
    //
    // Thinking sections, however, are a bit more nuanced:
    // 1. Thinking sections can be active or inactive.
    // 2. Thinking sections are active if there is no content section after it. In other words,
    //    thinking sections are active while the agent is making tool calls or reasoning.
    // 3. When thinking sections are active, we show *only* the most recent tool call
    //    (Reading, Searching, Thinking)
    // 4. When thinking sections are inactive (there *is* a content section after it),
    //    we show something like "> Thought for 2 minutes" where the active thinking items
    //    used to be. Once dropped down, all of the actions in the thinking section
    //    **grouped by type (Reading, Searching, Thinking)**
    let thinkingSection: {
        streamParts: Array<{
            payload: MessageStreamToolCallPartPayload | MessageStreamReasoningPartPayload;
            createdTime: Date;
        }>;
        previousBlockNodeTypeName: ContentBlockNodeTypeName | null;
    } = {
        streamParts: [],
        previousBlockNodeTypeName,
    };

    for (let index = 0; index < stream.parts.length; index++) {
        const {payload, createdTime} = stream.parts[index]!;

        // TODO(calebmer, #ai): List items are getting the wrong amount of spacing. We
        // should have less spacing between each list item.
        const currentBlockNodeTypeName =
            payload.type === "Content"
                ? (payload.content.lastChild!.type.name as ContentBlockNodeTypeName)
                : "fileRow";

        switch (payload.type) {
            case "ToolCall":
            case "Reasoning":
                thinkingSection.streamParts.push({
                    payload,
                    createdTime,
                });
                break;
            case "Content": {
                // When we see a content section, check to see if it was preceded by a thinking
                // section. If so, render the thinking section as a "Completed" thinking section.
                // This means it should look something like "> Thought for 2 minutes" that can be
                // dropped down to show all of the actions in the thinking section
                // **grouped by type (Reading, Searching, Thinking)**
                if (thinkingSection.streamParts.length > 0) {
                    // Inactive thinking section - show collapsible "Thought for X"
                    children.push(
                        <MessageStreamSummary
                            key={`thinking-summary-${thinkingSection.streamParts[0]!.createdTime.toISOString()}`}
                            message={message}
                            streamParts={thinkingSection.streamParts}
                            isThinkingSummaryComplete={true}
                            previousBlockNodeTypeName={thinkingSection.previousBlockNodeTypeName}
                            references={content.references}
                        />,
                    );
                    thinkingSection = {
                        streamParts: [],
                        previousBlockNodeTypeName: currentBlockNodeTypeName,
                    };

                    // NOTE(ifitzsimmons): We don't set `previousBlockNodeTypeName` to the current block
                    // node for non-Content parts. So if we are visiting a Content part after a thinking
                    // section, previousBlockNodeType will be null. However, once a thinking section is
                    // complete, there's a permanent piece of Content that we need to render for the
                    // thinking summary dropdown.
                    previousBlockNodeTypeName = "fileRow";
                }

                children.push(
                    <MessageStreamViewPart
                        key={index}
                        message={message}
                        payload={payload}
                        references={content.references}
                        posAttributeOffset={posAttributeOffset}
                        orderedListItemNumberByNode={orderedListItemNumberByNode}
                        withUserSelectNone={withUserSelectNone}
                        getClipboardSerializerPrefix={
                            isContentEmpty && previousBlockNodeTypeName === null
                                ? getClipboardSerializerPrefix
                                : undefined
                        }
                        previousBlockNodeTypeName={previousBlockNodeTypeName}
                        jumpAnimation={jumpAnimation}
                    />,
                );

                posAttributeOffset += payload.content.content.size;
                previousBlockNodeTypeName = currentBlockNodeTypeName;

                break;
            }
            default:
                throw exhaustive(payload);
        }
    }

    // If thinking section is not empty, then it's active. For active thinking sections
    // we show the most recent tool call (Reading, Searching, Thinking)
    if (thinkingSection.streamParts.length > 0) {
        children.push(
            <MessageStreamSummary
                key={`thinking-summary-${thinkingSection.streamParts[0]!.createdTime.toISOString()}`}
                message={message}
                streamParts={thinkingSection.streamParts}
                isThinkingSummaryComplete={false}
                previousBlockNodeTypeName={thinkingSection.previousBlockNodeTypeName}
                references={content.references}
            />,
        );
    } else if (children.length === 0) {
        children.push(
            <MessageStreamSummary
                key="first-section"
                message={message}
                streamParts={[]}
                previousBlockNodeTypeName={null}
                isThinkingSummaryComplete={false}
                references={emptyContentReferences}
            />,
        );
    }

    return <>{children}</>;
}

const MessageStreamViewPart = memo(function MessageStreamViewPart({
    message,
    payload,
    references,
    posAttributeOffset,
    orderedListItemNumberByNode,
    withUserSelectNone,
    getClipboardSerializerPrefix,
    previousBlockNodeTypeName,
    jumpAnimation,
}: {
    message: MessageModel<string> | OptimisticMessageModel;
    payload: MessageStreamPartPayload;
    references: ContentReferences;
    posAttributeOffset: number;
    orderedListItemNumberByNode: ReadonlyMap<Node, number>;
    withUserSelectNone: boolean;
    getClipboardSerializerPrefix: Memo<() => string | null> | undefined;
    previousBlockNodeTypeName: ContentBlockNodeTypeName | null;
    jumpAnimation: Memo<{from: number | null; to: number | null; startTime: Date}> | null;
}) {
    let node: ReactNode;

    switch (payload.type) {
        case "Content": {
            node = (
                <MessageStreamViewContentPart
                    message={message}
                    doc={payload.content}
                    references={references}
                    posAttributeOffset={posAttributeOffset}
                    orderedListItemNumberByNode={orderedListItemNumberByNode}
                    withUserSelectNone={withUserSelectNone}
                    getClipboardSerializerPrefix={getClipboardSerializerPrefix}
                    jumpAnimation={jumpAnimation}
                />
            );
            break;
        }
    }

    const currentBlockNodeTypeName =
        payload.type === "Content"
            ? (payload.content.firstChild!.type.name as ContentBlockNodeTypeName)
            : // HACK: Something with standalone margin.
              "fileRow";

    let space: Spacing | null = null;

    if (previousBlockNodeTypeName) {
        if (
            isContentListItemNodeTypeName(currentBlockNodeTypeName) &&
            isContentListItemNodeTypeName(previousBlockNodeTypeName)
        ) {
            space = contentStyles.paragraphMargin;
        } else if (
            hasStandaloneMarginByContentBlockNodeTypeName[currentBlockNodeTypeName] ||
            hasStandaloneMarginByContentBlockNodeTypeName[previousBlockNodeTypeName]
        ) {
            space = contentStyles.standaloneBlockMargin;
        } else {
            space = contentStyles.paragraphMargin;
        }
    }

    return (
        <>
            {space && <div style={{height: spacing[space]}} />}
            {node}
        </>
    );
});

function MessageStreamViewContentPart({
    message,
    doc,
    references,
    posAttributeOffset,
    orderedListItemNumberByNode,
    withUserSelectNone,
    getClipboardSerializerPrefix,
    jumpAnimation: originalJumpAnimation,
}: {
    message: MessageModel<string> | OptimisticMessageModel;
    doc: MessageContent;
    references: ContentReferences;
    posAttributeOffset: number;
    orderedListItemNumberByNode: ReadonlyMap<Node, number>;
    withUserSelectNone: boolean;
    getClipboardSerializerPrefix: Memo<() => string | null> | undefined;
    jumpAnimation: Memo<{from: number | null; to: number | null; startTime: Date}> | null;
}) {
    const jumpAnimation = useMemo(() => {
        if (originalJumpAnimation === null) return null;

        const jumpAnimation = {
            from:
                originalJumpAnimation.from !== null
                    ? Math.max(0, originalJumpAnimation.from - posAttributeOffset)
                    : null,
            to:
                originalJumpAnimation.to !== null
                    ? Math.min(doc.content.size, originalJumpAnimation.to - posAttributeOffset)
                    : null,
            startTime: originalJumpAnimation.startTime,
        };

        // If after offsetting, the jump animation doesn't make sense then we don't
        // have a jump animation for this part.
        if (jumpAnimation.from !== null && jumpAnimation.from > doc.content.size) return null;
        if (jumpAnimation.to !== null && jumpAnimation.to < 0) return null;

        return jumpAnimation;
    }, [doc.content.size, originalJumpAnimation, posAttributeOffset]);

    const content = useMemo(() => {
        let node: Node = doc;
        const firstNode = node.firstChild;

        if (firstNode?.type.name === "orderedListItem") {
            const orderStart = assertExists(orderedListItemNumberByNode.get(firstNode));

            node = node.type.create(
                node.attrs,
                [
                    firstNode.type.create(
                        {...firstNode.attrs, orderStart},
                        firstNode.content.content,
                        firstNode.marks,
                    ),
                    ...node.content.content.slice(1),
                ],
                node.marks,
            );
        }

        return {doc: node, references};
    }, [doc, orderedListItemNumberByNode, references]);

    return (
        <ContentView
            className={messagingStyles.withPointerToolbarClassName}
            data-room={!message.isOptimistic ? message.getRoomKey() : undefined}
            data-index={!message.isOptimistic ? message.index : undefined}
            content={content}
            posAttributeOffset={posAttributeOffset}
            withUserSelectNone={withUserSelectNone}
            getClipboardSerializerPrefix={getClipboardSerializerPrefix}
            jumpAnimation={jumpAnimation}
        />
    );
}
