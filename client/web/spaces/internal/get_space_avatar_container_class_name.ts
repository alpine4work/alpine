import classNames from "classnames";
import {spaceAvatarBorderRadius} from "~/client/web/styles/space_settings_shared_styles.js";
import {
    ColorSchemeVar,
    hiddenIfDarkColorSchemeClassName,
    hiddenIfLightColorSchemeClassName,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {AvatarTheme} from "~/shared/avatar/avatar_schema.js";
import {Spacing} from "~/shared/design/core/spacing.js";

export function getSpaceAvatarContainerClassName({
    size,
    theme,
    backgroundColor,
    withHiddenClassName,
}: {
    size: Spacing;
    theme: AvatarTheme;
    backgroundColor?: ColorSchemeVar;
    withHiddenClassName: boolean;
}) {
    const hiddenClassName = withHiddenClassName
        ? theme === "dark"
            ? hiddenIfLightColorSchemeClassName
            : hiddenIfDarkColorSchemeClassName
        : undefined;
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
