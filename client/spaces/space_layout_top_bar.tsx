import {Bell, MagnifyingGlass, Plus} from "phosphor-react";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {IconButton} from "~/client/design/icon_button";
import {useSpaceContext} from "~/client/spaces/space_context";
import {spacing} from "~/shared/design/spacing";
import {SpaceModel} from "~/shared/models/space_model";

// TODO(calebmer): Keyboard shortcuts for everything in top bar

export function SpaceLayoutTopBar({space}: {space: SpaceModel}) {
    const {currentAccount} = useSpaceContext();

    return (
        <Box
            flexShrink="0"
            backgroundColor="grey-0"
            borderBottom="grey-10"
            position="relative"
            zIndex="10"
            height="10"
            display="flex"
            alignItems="center"
        >
            <Box
                width="48"
                display="flex"
                justifyContent="flex-start"
                alignItems="center"
                paddingX="1"
            >
                <Button paddingX="2">
                    <Box fontSize="200" fontStyle="truncate-semi-bold">
                        {space.name}
                    </Box>
                </Button>
            </Box>
            <Box flexGrow="1" display="flex" justifyContent="center" alignItems="center">
                <Box
                    minWidth="48"
                    maxWidth="128"
                    width="full"
                    backgroundColor="grey-5"
                    border="grey-10"
                    borderRadius="md"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    padding="1"
                    gap="1"
                    color="grey-50"
                    cursor="text"
                >
                    <MagnifyingGlass size={spacing["4"]} />
                    <Box fontStyle="truncate">Search {space.name}…</Box>
                </Box>
            </Box>
            <Box
                width="48"
                display="flex"
                justifyContent="flex-end"
                alignItems="center"
                gap="1"
                paddingX="2"
            >
                <IconButton size="md" description="Create" tooltipPlacement="bottom">
                    <Plus />
                </IconButton>
                <IconButton size="md" description="Notifications" tooltipPlacement="bottom">
                    <Bell />
                </IconButton>
                <Box paddingLeft="1">
                    <IconButton
                        size="md"
                        variant="accent"
                        description="Account"
                        tooltipPlacement="bottom-end"
                    >
                        <AccountAvatar account={currentAccount} size="6" />
                    </IconButton>
                </Box>
            </Box>
        </Box>
    );
}
