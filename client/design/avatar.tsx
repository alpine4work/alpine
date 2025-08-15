import {useMemo} from "react";
import {
    BorderRadius,
    backgroundColorVar,
    borderRadius as borderRadiusValues,
} from "~/client/styles/styles.js";
import {avatarContentType} from "~/shared/avatar/avatar_constants.js";
import {getAvatarThemeColors} from "~/shared/design/core/avatar_theme_colors.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";
import {encodeBase64} from "~/shared/helpers/binary/base64.js";
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
    borderRadius?: BorderRadius;

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

    /**
     * Optional content for the avatar.
     */
    content: Uint8Array | null;
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
    content,
}: AvatarProps) {
    return content ? (
        <AccountAvatarWithImage
            content={content}
            borderRadius={borderRadius}
            avatarClassName={avatarClassName}
            size={size}
        />
    ) : (
        <DefaultAccountAvatar
            id={id}
            text={text}
            size={size}
            backgroundColor={backgroundColor}
            avatarClassName={avatarClassName}
            avatarTextClassName={avatarTextClassName}
            backgroundBorderWidth={backgroundBorderWidth}
            borderRadius={borderRadius}
        />
    );
}

function AccountAvatarWithImage({
    content,
    borderRadius,
    avatarClassName,
    size,
}: {
    content: Uint8Array;
    borderRadius: BorderRadius;
    avatarClassName?: string;
    size: Spacing;
}) {
    const imageUrl = useMemo(
        () => `data:${avatarContentType};base64,${encodeBase64(content)}`,
        [content],
    );

    return (
        <span
            className={avatarClassName}
            style={{
                width: spacing[size],
                height: spacing[size],
                position: "relative",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                overflow: "hidden",
            }}
        >
            <img
                src={imageUrl}
                style={{
                    width: "100%",
                    height: "100%",
                    objectFit: "cover",
                    borderRadius: borderRadiusValues[borderRadius],
                }}
                aria-hidden="true"
                // Do not render an alt tag as avatars are not important for screen readers
                alt=""
            />
        </span>
    );
}

function DefaultAccountAvatar({
    id,
    text,
    size,
    backgroundColor,
    avatarClassName,
    avatarTextClassName,
    backgroundBorderWidth,
    borderRadius,
}: {
    id: AccountId | SpaceId;
    text: string;
    size: Spacing;
    backgroundColor?: string;
    avatarClassName?: string;
    avatarTextClassName?: string;
    backgroundBorderWidth?: 1 | 1.5 | 2 | 3;
    borderRadius: BorderRadius;
}) {
    // Get a consistent theme color based on the ID (same ID = same color always)
    const avatarColors =
        backgroundColor !== undefined
            ? {backgroundColor, textColor: undefined}
            : getAvatarThemeColors(id);

    return (
        <span
            className={avatarClassName}
            style={{
                width: spacing[size],
                height: spacing[size],
                borderRadius: borderRadiusValues[borderRadius],
                backgroundColor: avatarColors.backgroundColor,
                boxShadow:
                    backgroundBorderWidth !== undefined
                        ? `0px 0px 0px ${backgroundBorderWidth}px ${backgroundColorVar}`
                        : undefined,
            }}
        >
            <span
                className={avatarTextClassName}
                style={{
                    transform: `scale(${parseInt(size, 10) / 8})`,
                    color: avatarColors.textColor,
                }}
                aria-hidden="true"
            >
                {text.toUpperCase()}
            </span>
        </span>
    );
}
