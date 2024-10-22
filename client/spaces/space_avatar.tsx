import GraphemeSplitter from "grapheme-splitter";
import {useMemo} from "react";
import {Box} from "~/client/design/box.js";
import {Spacing} from "~/shared/design/core/spacing.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

export const spaceAvatarBorderRadius = "1";

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
                fontSize="75"
                style={{transform: `scale(${parseInt(size, 10) / 8})`}}
                aria-hidden="true"
            >
                {useMemo(() => {
                    const splitter = new GraphemeSplitter();
                    const graphemes = splitter.iterateGraphemes(space.name);
                    return graphemes.next().value;
                }, [space.name])}
            </Box>
        </Box>
    );
}
