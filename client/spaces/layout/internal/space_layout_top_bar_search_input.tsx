import {MagnifyingGlass} from "phosphor-react";
import {usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {Spacer} from "~/client/design/spacer.js";
import {usePreloadAffinitiveSearchEntities} from "~/client/search/search_modal.js";
import {spacing} from "~/shared/design/spacing.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";
import {sprinkles} from "~/shared/styles/styles.js";

export function SpaceLayoutTopBarSearchInput({
    space,
    onPress,
}: {
    space: SpaceModel;
    onPress: () => void;
}) {
    const {pressProps} = usePress({onPress});

    // Preload affinitive search entities so they're ready when the search modal
    // opens. We expect search to be the primary way users navigate around the
    // product.
    usePreloadAffinitiveSearchEntities();

    return (
        <Box flexGrow="1" display="flex" justifyContent="center" alignItems="center">
            <Box
                {...pressProps}
                position="relative"
                minWidth="48"
                maxWidth="96"
                width="full"
                border="grey-10"
                borderRadius="md"
                display="flex"
                justifyContent="center"
                alignItems="center"
                padding="1"
                gap="1.5"
                color="grey-50"
                cursor="text"
            >
                <Spacer
                    // Add a bit of space to visually center the "Search Test" text even if it's
                    // not true center.
                    space="3"
                />
                <MagnifyingGlass size={spacing["3"]} className={sprinkles({flexShrink: "0"})} />
                <Box fontStyle="truncate">Search {space.name}</Box>
                <Box flexShrink="0" fontSize="50" color="grey-30">
                    shift+shift
                </Box>
            </Box>
        </Box>
    );
}
