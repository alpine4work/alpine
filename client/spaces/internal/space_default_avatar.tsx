import {useMemo} from "react";
import {AvatarDefault} from "~/client/avatar/avatar_default.js";
import {Box} from "~/client/design/box.js";
import {colors} from "~/shared/design/core/colors.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {getAvatarDefaultDesign} from "~/shared/spaces/get_avatar_default_design.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export function SpaceDefaultAvatar({space, size}: {space: SpaceModel; size: Spacing}) {
    const avatarDesign = useMemo(() => {
        return getAvatarDefaultDesign(space.id, null);
    }, [space.id]);

    return (
        <Box
            position="relative"
            width="full"
            height="full"
            style={{backgroundColor: `${colors[`${avatarDesign.backgroundColor}-20`]}`}}
        >
            <AvatarDefault size={size} reaction={avatarDesign.reaction} />
        </Box>
    );
}
