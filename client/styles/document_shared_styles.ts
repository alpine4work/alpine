import {
    messageInputMinHeight,
    messageViewMinHeight,
} from "~/client/styles/messaging_shared_styles.js";
import {addRemLengths, parseRemLength} from "~/shared/design/core/spacing.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

export const documentCommentThreadPreviewHeight = "48";

export const documentCommentThreadListViewMaxWidth = "160";
export const documentCommentThreadActionsHeight = "7";
export const documentCommentThreadHeaderPaddingY = "5";

export const documentCommentThreadHeaderMinHeightWithoutPaddingTop = addRemLengths(
    documentCommentThreadActionsHeight,
    documentCommentThreadHeaderPaddingY,
    documentCommentThreadPreviewHeight,
    documentCommentThreadHeaderPaddingY,
);

export const documentCommentThreadHeaderMinHeight = addRemLengths(
    documentCommentThreadHeaderPaddingY,
    documentCommentThreadHeaderMinHeightWithoutPaddingTop,
);

export const documentCommentThreadCountAgainstLimit = mapObjectValues(
    messageViewMinHeight,
    (messageViewMinHeight, spacingScale) =>
        mapObjectValues(
            messageViewMinHeight,
            (messageViewMinHeight, platform) =>
                parseRemLength(
                    addRemLengths(
                        documentCommentThreadHeaderMinHeight,
                        messageInputMinHeight[spacingScale][platform],
                    ),
                ) / parseRemLength(messageViewMinHeight),
        ),
);

export const documentContentEditorSidebarWidth = "96";
