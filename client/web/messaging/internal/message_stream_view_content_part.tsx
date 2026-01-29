import {Node} from "prosemirror-model";
import {Memo, useMemo} from "react";
import {ContentView} from "~/client/web/content/content_view.js";
import {hasStandaloneMarginByContentBlockNodeTypeName} from "~/client/web/content/has_standalone_margin_by_content_block_node_type_name.js";
import {contentStyles, messagingStyles} from "~/client/web/styles/styles.js";
import {
    ContentBlockNodeTypeName,
    isContentListItemNodeTypeName,
} from "~/shared/content/content_node_type_name.js";
import {ContentReferences} from "~/shared/content/content_references.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {MessageContent} from "~/shared/messaging/message_content_schema.js";
import {MessageModel, OptimisticMessageModel} from "~/shared/messaging/message_model.js";
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

export function MessageStreamViewContentPart({
    message,
    doc,
    references,
    posAttributeOffset,
    orderedListItemNumberByNode,
    withUserSelectNone,
    getClipboardSerializerAuthorPrefix,
    jumpAnimation: originalJumpAnimation,
    previousBlockNodeTypeName,
}: {
    message: MessageModel<string> | OptimisticMessageModel;
    doc: MessageContent;
    references: ContentReferences;
    posAttributeOffset: number;
    orderedListItemNumberByNode: ReadonlyMap<Node, number>;
    withUserSelectNone: boolean;
    getClipboardSerializerAuthorPrefix: Memo<() => AccountModel | null> | undefined;
    jumpAnimation: Memo<{from: number | null; to: number | null; startTime: Date}> | null;
    previousBlockNodeTypeName: ContentBlockNodeTypeName | null;
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

    const currentBlockNodeTypeName = doc.firstChild!.type.name as ContentBlockNodeTypeName;

    let space: Spacing | null = null;

    if (previousBlockNodeTypeName) {
        if (
            isContentListItemNodeTypeName(currentBlockNodeTypeName) &&
            isContentListItemNodeTypeName(previousBlockNodeTypeName)
        ) {
            space = contentStyles.paragraphMargin;
        } else if (
            currentBlockNodeTypeName === "divider" ||
            previousBlockNodeTypeName === "divider"
        ) {
            space = contentStyles.messageDividerMargin;
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
            <ContentView
                className={messagingStyles.withPointerToolbarClassName}
                data-room={!message.isOptimistic ? message.getRoomKey() : undefined}
                data-index={!message.isOptimistic ? message.index : undefined}
                content={content}
                posAttributeOffset={posAttributeOffset}
                withUserSelectNone={withUserSelectNone}
                getClipboardSerializerAuthorPrefix={getClipboardSerializerAuthorPrefix}
                jumpAnimation={jumpAnimation}
            />
        </>
    );
}
