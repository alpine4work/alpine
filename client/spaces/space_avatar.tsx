import classNames from "classnames";
import {useMemo} from "react";
import {AvatarImage} from "~/client/avatar/avatar_image.js";
import {Box} from "~/client/design/box.js";
import {spaceAvatarBorderRadius} from "~/client/styles/space_settings_shared_styles.js";
import {
    hiddenIfDarkColorSchemeClassName,
    hiddenIfLightColorSchemeClassName,
    sprinkles,
} from "~/client/styles/styles.js";
import {AvatarTheme} from "~/shared/avatar/avatar_schema.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {iterateGraphemes} from "~/shared/helpers/string/iterate_graphemes.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export function SpaceAvatar({space, size}: {space: SpaceModel; size: Spacing}) {
    return (
        <>
            {/* Light theme avatar */}
            <InternalSpaceAvatar space={space} size={size} theme="light" />
            {/* Dark theme avatar */}
            <InternalSpaceAvatar space={space} size={size} theme="dark" />
        </>
    );
}

function DefaultSpaceAvatar({space, size}: {space: SpaceModel; size: Spacing}) {
    const spaceInitial = useMemo(() => {
        const graphemes = iterateGraphemes(space.name);
        return graphemes.next().value || "";
    }, [space.name]);

    return (
        <Box
            width={size}
            height={size}
            borderRadius={spaceAvatarBorderRadius}
            backgroundColor="grey-30-const"
        >
            <Box
                fontSize="50"
                style={{transform: `scale(${parseInt(size, 10) / 8})`}}
                aria-hidden="true"
            >
                {spaceInitial.toUpperCase()}
            </Box>
        </Box>
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

    if (!avatarContent) {
        return <DefaultSpaceAvatar space={space} size={size} />;
    }

    const hiddenClassName =
        theme === "dark" ? hiddenIfLightColorSchemeClassName : hiddenIfDarkColorSchemeClassName;

    return (
        <Box
            className={classNames(
                sprinkles({
                    display: "flex",
                    justifyContent: "center",
                    alignItems: "center",
                    color: "grey-80-const",
                }),
                hiddenClassName,
            )}
            width={size}
            height={size}
            borderRadius={spaceAvatarBorderRadius}
            position="relative"
            overflow="hidden"
            display="flex"
            alignItems="center"
            justifyContent="center"
        >
            <AvatarImage content={avatarContent} />
        </Box>
    );
}
