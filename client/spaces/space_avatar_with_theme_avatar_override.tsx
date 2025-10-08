import {AvatarImage} from "~/client/avatar/avatar_image.js";
import {Box} from "~/client/design/box.js";
import {getSpaceAvatarContainerClassName} from "~/client/spaces/internal/get_space_avatar_container_class_name.js";
import {SpaceDefaultAvatar} from "~/client/spaces/internal/space_default_avatar.js";
import {AvatarTheme} from "~/shared/avatar/avatar_schema.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export function SpaceAvatarWithThemeOverride({
    space,
    size,
    theme,
}: {
    space: SpaceModel;
    size: Spacing;
    theme: AvatarTheme;
}) {
    const avatarContent =
        theme === "dark" ? space.avatars?.darkTheme?.content : space.avatars?.lightTheme?.content;

    const backgroundColor = avatarContent
        ? theme === "dark"
            ? "grey-100-const"
            : "grey-0-const"
        : "grey-30-const";

    return (
        <Box
            className={getSpaceAvatarContainerClassName({
                size,
                theme,
                backgroundColor,
                withHiddenClassName: false,
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
