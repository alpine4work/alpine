import {useMemo} from "react";
import {Box} from "~/client/design/box.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {iterateGraphemes} from "~/shared/helpers/string/iterate_graphemes.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export function SpaceAvatarWithInitials({space, size}: {space: SpaceModel; size: Spacing}) {
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
