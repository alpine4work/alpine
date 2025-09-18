import {AvatarImage} from "~/client/avatar/avatar_image.js";
import {Box} from "~/client/design/box.js";
import {getSpaceAvatarContainerClassName} from "~/client/spaces/internal/get_space_avatar_container_class_name.js";
import {SpaceAvatarWithInitials} from "~/client/spaces/internal/space_avatar_with_initials.js";
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
    let avatarContent = null;
    let avatarContentBackgroundColor: ColorSchemeVar | undefined = undefined;

    // If we're showing a dynamic avatar and the space doesn't have the theme icon,
    // just default to one we do have mode icon.
    if (theme === "dark" && !space.avatars?.darkTheme?.content) {
        avatarContent = space.avatars?.lightTheme?.content;
        // Render the light theme avatar icon on a dark background.
        avatarContentBackgroundColor = "grey-0-const";
    } else if (theme === "light" && !space.avatars?.lightTheme?.content) {
        avatarContent = space.avatars?.darkTheme?.content;
        // Render the dark theme avatar icon on a light background.
        avatarContentBackgroundColor = "grey-100-const";
    }

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
                <SpaceAvatarWithInitials space={space} size={size} />
            )}
        </Box>
    );
}
