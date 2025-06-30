import {useMemo} from "react";
import {Box} from "~/client/design/box.js";
import {spaceAvatarBorderRadius} from "~/client/styles/space_settings_shared_styles.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {iterateGraphemes} from "~/shared/helpers/string/iterate_graphemes.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export function SpaceAvatar({space, size}: {space: SpaceModel; size: Spacing}) {
    return (
        <Box
            backgroundColor="grey-30-const"
            width={size}
            height={size}
            borderRadius={spaceAvatarBorderRadius}
            display="flex"
            justifyContent="center"
            alignItems="center"
            color="grey-80-const"
        >
            <Box
                fontSize="50"
                style={{transform: `scale(${parseInt(size, 10) / 8})`}}
                aria-hidden="true"
            >
                {useMemo(() => {
                    const graphemes = iterateGraphemes(space.name);
                    return graphemes.next().value;
                }, [space.name])}
            </Box>
        </Box>
    );
}
