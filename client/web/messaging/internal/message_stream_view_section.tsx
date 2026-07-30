import {Node} from "prosemirror-model";
import {Memo, ReactNode, Ref} from "react";
import {MessageStreamViewContentPart} from "~/client/web/messaging/internal/message_stream_view_content_part.js";
import {MessageStreamViewThinkingSummary} from "~/client/web/messaging/internal/message_stream_view_thinking_summary.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {ContentBlockNodeTypeName} from "~/shared/content/content_node_type_name.js";
import {MessageContentWithReferences} from "~/shared/content/message_content_schema.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {MessageModel, OptimisticMessageModel} from "~/shared/messaging/message_model.js";
import {
    MessageStreamContentPartPayload,
    MessageStreamPartPayload,
} from "~/shared/messaging/message_schema.js";
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
    expandedRef,
    isExpanded,
    onToggleIsExpanded,
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
    expandedRef: Ref<HTMLDivElement | null>;
    isExpanded: boolean;
    onToggleIsExpanded: () => void;
}) {
    const children: Array<ReactNode> = [];

    let posAttributeOffset = section.posAttributeOffset;
    let previousBlockNodeTypeName: ContentBlockNodeTypeName | null = null;

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
            />,
        );

        posAttributeOffset += part.content.content.size;
        previousBlockNodeTypeName = part.content.lastChild!.type.name as ContentBlockNodeTypeName;
    }

    return (
        <>
            {!isFirstSection && (
                <div style={{height: spacing[contentStyles.standaloneBlockMargin]}} />
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
        </>
    );
}
