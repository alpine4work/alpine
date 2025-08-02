import {backgroundColorVar, borderRadius as borderRadiusValues} from "~/client/styles/styles.js";
import {getAvatarThemeColor} from "~/shared/design/core/avatar_theme_color.js";
import {colors} from "~/shared/design/core/colors.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {AccountId, SpaceId} from "~/shared/id/types/id_types.js";

// This component is rendered in hot paths (like `<TaskRowView>`) avoid using
// `<Box>` until we implement a transform that automatically inlines `<Box>`.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const Box = null;

export interface AvatarProps {
    /**
     * Unique identifier used to consistently assign theme colors.
     * This should be a stable ID like an account ID or space ID.
     */
    id: AccountId | SpaceId;

    /**
     * The text to display inside the avatar (typically initials).
     */
    text: string;

    /**
     * Size of the avatar.
     */
    size: Spacing;

    /**
     * Optional border width for the avatar background.
     */
    backgroundBorderWidth?: 1 | 1.5 | 2 | 3;

    /**
     * Border radius style. Defaults to "full" for circular avatars.
     */
    borderRadius?: "none" | "full" | "0.5" | "1" | "1.5" | "2" | "2.5" | "3" | "3.5" | "4";

    /**
     * Optional class name for the container.
     */
    avatarClassName?: string;

    /**
     * Optional class name for the avatar text.
     */
    avatarTextClassName?: string;

    /**
     * Optional background color for the avatar.
     */
    backgroundColor?: string;
}

/**
 * A canonical avatar component that displays
 * 1. text (typically initials) with a themed background color along with a
 *    border with a darker shade of the background color. The background color
 *    is consistently assigned based on the provided ID, ensuring the same ID
 *    always gets the same color.
 * 2. An avatar image if provided.
 */
export function Avatar({
    id,
    text,
    size,
    backgroundBorderWidth,
    backgroundColor,
    borderRadius = "full",
    avatarClassName,
    avatarTextClassName,
}: AvatarProps) {
    // Get a consistent theme color based on the ID (same ID = same color always)
    const finalBackgroundColor = backgroundColor ?? colors[getAvatarThemeColor(id)];

    return (
        <span
            className={avatarClassName}
            style={{
                width: spacing[size],
                height: spacing[size],
                borderRadius: borderRadiusValues[borderRadius],
                backgroundColor: finalBackgroundColor,
                boxShadow:
                    backgroundBorderWidth !== undefined
                        ? `0px 0px 0px ${backgroundBorderWidth}px ${backgroundColorVar}`
                        : undefined,
            }}
        >
            <span
                className={avatarTextClassName}
                style={{transform: `scale(${parseInt(size, 10) / 8})`}}
                aria-hidden="true"
            >
                {text.toUpperCase()}
            </span>
        </span>
    );
}
