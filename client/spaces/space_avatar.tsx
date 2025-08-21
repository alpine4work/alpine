import {useMemo} from "react";
import {Avatar} from "~/client/design/avatar.js";
import {spaceAvatarBorderRadius} from "~/client/styles/space_settings_shared_styles.js";
import {colorSchemeVars, sprinkles} from "~/client/styles/styles.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {iterateGraphemes} from "~/shared/helpers/string/iterate_graphemes.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export function SpaceAvatar({space, size}: {space: SpaceModel; size: Spacing}) {
    const spaceInitial = useMemo(() => {
        const graphemes = iterateGraphemes(space.name);
        return graphemes.next().value || "";
    }, [space.name]);

    return (
        <Avatar
            backgroundColor={colorSchemeVars["grey-30-const"]}
            id={space.id}
            text={spaceInitial}
            size={size}
            borderRadius={spaceAvatarBorderRadius}
            avatarClassName={sprinkles({
                display: "flex",
                justifyContent: "center",
                alignItems: "center",
                color: "grey-80-const",
            })}
            avatarTextClassName={sprinkles({
                fontSize: "50",
            })}
            // TODO(#add-space-avatar-support)
            // Need a way to pick the appropriate avatar based on color scheme that
            // works with SSR.
            content={space.avatars?.lightTheme?.content ?? null}
        />
    );
}
