import {hasStandaloneMarginByContentBlockNodeTypeName} from "~/client/web/content/has_standalone_margin_by_content_block_node_type_name.js";
import {messageViewMarginY} from "~/client/web/styles/messaging_shared_styles.js";
import {contentStyles} from "~/client/web/styles/styles.js";
import {isContentEmpty} from "~/shared/content/is_content_empty.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {MessageModelBase} from "~/shared/messaging/message_model.js";

export function getMessageViewMarginBottom({
    isLastMessage,
    message,
    nextMessage,
    shouldMergeWithNextMessage,
}: {
    isLastMessage: boolean;
    message: MessageModelBase;
    nextMessage: MessageModelBase | null;
    shouldMergeWithNextMessage: boolean;
}): Spacing {
    if (isLastMessage || !shouldMergeWithNextMessage) {
        return messageViewMarginY;
    }

    if (
        message.payload.type !== "Content" ||
        message.payload.content.doc.childCount === 0 ||
        nextMessage?.payload.type !== "Content" ||
        nextMessage.payload.content.doc.childCount === 0
    ) {
        return contentStyles.paragraphMargin;
    }

    const isNextMessageContentEmpty = isContentEmpty(nextMessage.payload.content.doc);

    if (
        message.payload.files.length > 0 &&
        isNextMessageContentEmpty &&
        nextMessage.payload.files.length > 0
    ) {
        return contentStyles.fileRowGapWidth;
    }

    if (
        message.payload.content.doc.lastChild!.type.name === "divider" ||
        nextMessage.payload.content.doc.firstChild!.type.name === "divider"
    ) {
        return contentStyles.messageDividerMargin;
    }

    if (
        hasStandaloneMarginByContentBlockNodeTypeName[
            message.payload.content.doc.lastChild!.type.name
        ] ||
        hasStandaloneMarginByContentBlockNodeTypeName[
            nextMessage.payload.content.doc.firstChild!.type.name
        ] ||
        message.payload.files.length > 0 ||
        (isNextMessageContentEmpty && nextMessage.payload.files.length > 0)
    ) {
        return contentStyles.standaloneBlockMargin;
    }

    return contentStyles.paragraphMargin;
}
