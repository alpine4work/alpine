import classNames from "classnames";
import {useMemo} from "react";
import {AvatarImage} from "~/client/avatar/avatar_image.js";
import {Box} from "~/client/design/box.js";
import {spaceAvatarBorderRadius} from "~/client/styles/space_settings_shared_styles.js";
import {
    ColorSchemeVar,
    hiddenIfDarkColorSchemeClassName,
    hiddenIfLightColorSchemeClassName,
    sprinkles,
} from "~/client/styles/styles.js";
import {AvatarTheme} from "~/shared/avatar/avatar_schema.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {iterateGraphemes} from "~/shared/helpers/string/iterate_graphemes.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

function getSpaceAvatarContainerClassName({
    size,
    theme,
    backgroundColor,
}: {
    size: Spacing;
    theme: AvatarTheme;
    backgroundColor?: ColorSchemeVar;
}) {
    const hiddenClassName =
        theme === "dark" ? hiddenIfLightColorSchemeClassName : hiddenIfDarkColorSchemeClassName;
    return classNames(
        hiddenClassName,
        sprinkles({
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            width: size,
            height: size,
            borderRadius: spaceAvatarBorderRadius,
            position: "relative",
            overflow: "hidden",
            backgroundColor,
        }),
    );
}

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
    const avatarContent =
        theme === "dark" ? space.avatars?.darkTheme?.content : space.avatars?.lightTheme?.content;

    return avatarContent ? (
        <Box className={getSpaceAvatarContainerClassName({size, theme})}>
            <AvatarImage content={avatarContent} />
        </Box>
    ) : (
        <Box
            className={getSpaceAvatarContainerClassName({
                size,
                theme,
                backgroundColor: "grey-30-const",
            })}
        >
            <DefaultSpaceAvatar space={space} size={size} />
        </Box>
    );
}

function DefaultSpaceAvatar({space, size}: {space: SpaceModel; size: Spacing}) {
    const spaceInitial = useMemo(() => {
        const graphemes = iterateGraphemes(space.name);
        return graphemes.next().value || "";
    }, [space.name]);

    return (
        <Box
            fontSize="50"
            style={{transform: `scale(${parseInt(size, 10) / 8})`}}
            aria-hidden="true"
        >
            {spaceInitial.toUpperCase()}
        </Box>
    );
}
