import {Bell, MagnifyingGlass, Plus} from "phosphor-react";
import {useNavigate} from "react-router-dom";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {IconButton} from "~/client/design/icon_button";
import {MenuButton} from "~/client/design/menu_button";
import {useShowToast} from "~/client/design/toast";
import {useSpaceContext} from "~/client/spaces/space_context";
import {spacing} from "~/shared/design/spacing";
import {UnimplementedError} from "~/shared/error/error";
import {errorDisplayMessage} from "~/shared/error/error_display_message";
import {SpaceModel} from "~/shared/models/space_model";

// TODO(calebmer): Keyboard shortcuts for everything in top bar

export function SpaceLayoutTopBar({space}: {space: SpaceModel}) {
    const navigate = useNavigate();
    const showToast = useShowToast();
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
                <Button
                    paddingX="2"
                    onPress={() => {
                        showToast({
                            type: "Error",
                            title: "Can not navigate to home page",
                            error: new UnimplementedError(
                                "Home page has not been implemented yet",
                                {
                                    displayMessage: errorDisplayMessage`Home page has not been implemented yet.`,
                                },
                            ),
                        });
                    }}
                >
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
                    onClick={() => {
                        showToast({
                            type: "Error",
                            title: "Can not open search",
                            error: new UnimplementedError("Search has not been implemented yet", {
                                displayMessage: errorDisplayMessage`Search has not been implemented yet.`,
                            }),
                        });
                    }}
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
                <IconButton
                    size="md"
                    description="Notifications"
                    tooltipPlacement="bottom"
                    onPress={() => {
                        showToast({
                            type: "Error",
                            title: "Can not open notifications",
                            error: new UnimplementedError(
                                "Notifications have not been implemented yet",
                                {
                                    displayMessage: errorDisplayMessage`Notifications have not been implemented yet. Implementation is planned to start April 3, 2023.`,
                                },
                            ),
                        });
                    }}
                >
                    <Bell />
                </IconButton>
                <Box paddingLeft="1">
                    <MenuButton
                        placement="bottom-end"
                        actions={[
                            {
                                label: "Sign out",
                                onPress: () => navigate("/sign-out"),
                            },
                        ]}
                    >
                        <IconButton
                            size="md"
                            variant="accent"
                            description="Account"
                            tooltipPlacement="bottom-end"
                        >
                            <AccountAvatar account={currentAccount} size="6" />
                        </IconButton>
                    </MenuButton>
                </Box>
            </Box>
        </Box>
    );
}
