// We put styling constants in this file that are needed outside of
// `client/messaging` by packages that don't want to take a dependency on
// `client/messaging`. For example `client/content`.

import {RemLength, Spacing, addRemLengths, spacing} from "~/shared/design/spacing.js";
import {contentSchemaStyles} from "~/shared/styles/styles.js";

export const messageInputMinHeight: RemLength = "3.5rem";
export const messageViewBubbleBorderRadius = "xl" as const;
export const messageViewBubblePaddingX: Spacing = "1";
export const messageViewBubblePaddingY: Spacing = "2";
export const messageViewMergedMarginY: Spacing = "0.5";

export const messageViewBubbleMinHeight: RemLength = addRemLengths(
    spacing[messageViewBubblePaddingY],
    contentSchemaStyles.paragraphLineHeight,
    spacing[messageViewBubblePaddingY],
);

export const messageViewMinHeight: RemLength = addRemLengths(
    messageViewBubbleMinHeight,
    spacing[messageViewMergedMarginY],
);

/**
 * The minimum number of minutes between when we insert timestamp dividers into
 * a list of messages.
 *
 * If an hour passed without a message, insert a divider between messages. We
 * use an hour since that's a pretty standard meeting time. If an hour long
 * meeting has passed we assume context is lost so revealing the time
 * is useful.
 *
 * Also used to determine when we should increment the loud notification count
 * for a chat. If many messages are sent within an hour then we only increment
 * the loud notification count once. If two messages are sent more than an hour
 * apart we increment the loud notification count twice. By using the same time
 * heuristic as timestamp dividers the user should be able to build a mental
 * model for what the notification count is showing them. There are clearly
 * multiple "sections" of the conversation visually when they go to inspect it.
 */
export const minMessageViewTimestampDividerElapsedMinutes = 60;
