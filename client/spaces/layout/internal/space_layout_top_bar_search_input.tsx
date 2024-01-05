import {MagnifyingGlass} from "phosphor-react";
import {usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {usePreloadAffinitiveSearchEntities} from "~/client/search/search_modal.js";
import {spacing} from "~/shared/design/spacing.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";

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
                <MagnifyingGlass size={spacing["3"]} />
                <Box fontStyle="truncate">Search {space.name}</Box>
                <Box fontSize="50" color="grey-30">
                    shift+shift
                </Box>
            </Box>
        </Box>
    );
}
