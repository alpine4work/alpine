import {AvatarImage} from "~/client/avatar/avatar_image.js";
import {Box} from "~/client/design/box.js";
import {getSpaceAvatarContainerClassName} from "~/client/spaces/internal/get_space_avatar_container_class_name.js";
import {SpaceDefaultAvatar} from "~/client/spaces/internal/space_default_avatar.js";
import {ColorSchemeVar} from "~/client/styles/styles.js";
import {AvatarTheme} from "~/shared/avatar/avatar_schema.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export function SpaceAvatar({space, size}: {space: SpaceModel; size: Spacing}) {
    // NOTE(ifitzsimmons): We render two avatars and then rely on CSS to hide the appropriate
    // avatar according to the color theme ("light" or "dark"). For example, if a user is using
    // dark mode, the "light" InternalSpaceAvatar will be hidden.
    return (
        <>
            {/* Light theme avatar */}
            <InternalSpaceAvatar space={space} size={size} theme="light" />
            {/* Dark theme avatar */}
            <InternalSpaceAvatar space={space} size={size} theme="dark" />
        </>
    );
}

function InternalSpaceAvatar({
    space,
    size,
    theme,
}: {
    space: SpaceModel;
    size: Spacing;
    theme: AvatarTheme;
}) {
    const {avatarContent, avatarContentBackgroundColor} = getContentForThemeAndBackgroundColors(
        space,
        theme,
    );

    const backgroundColor = avatarContent ? avatarContentBackgroundColor : "grey-30-const";

    return (
        <Box
            className={getSpaceAvatarContainerClassName({
                size,
                theme,
                withHiddenClassName: true,
                backgroundColor,
            })}
        >
            {avatarContent ? (
                <AvatarImage content={avatarContent} />
            ) : (
                <SpaceDefaultAvatar space={space} size={size} />
            )}
        </Box>
    );
}

function getContentForThemeAndBackgroundColors(
    space: SpaceModel,
    theme: AvatarTheme,
): {
    avatarContent: Uint8Array | undefined | null;
    avatarContentBackgroundColor: ColorSchemeVar | undefined;
} {
    const darkThemeAvatarContent = space.avatars?.darkTheme?.content;
    const lightThemeAvatarContent = space.avatars?.lightTheme?.content;

    if (theme === "dark" && !darkThemeAvatarContent && lightThemeAvatarContent) {
        // If user is using dark theme and there's no dark theme avatar content, but there
        // IS a light theme avatar, use the light theme avatar on a light background.
        return {
            avatarContent: lightThemeAvatarContent,
            avatarContentBackgroundColor: "grey-0-const",
        };
    } else if (theme === "light" && !lightThemeAvatarContent && darkThemeAvatarContent) {
        // If user is using light theme and there's no light theme avatar content, but there
        // IS a dark theme avatar, use the dark theme avatar on a dark background.
        return {
            avatarContent: darkThemeAvatarContent,
            avatarContentBackgroundColor: "grey-100-const",
        };
    } else {
        // If there is an avatar for the theme, or if there are no avatars for either theme,
        // use the avatar for the theme (which can be null)
        return {
            avatarContent: theme === "dark" ? darkThemeAvatarContent : lightThemeAvatarContent,
            avatarContentBackgroundColor: undefined,
        };
    }
}
