import {Bell, MagnifyingGlass} from "phosphor-react";
import {useEffect, useRef, useState} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {useWebSocket} from "~/client/cloudflare/use_web_socket";
import {useAppContext} from "~/client/context/app_context";
import {Box} from "~/client/design/box";
import {Button} from "~/client/design/button";
import {IconButton} from "~/client/design/icon_button";
import {MenuButton} from "~/client/design/menu_button";
import {useShowToast} from "~/client/design/toast";
import {useIsMobile} from "~/client/remix/use_is_mobile";
import {useNavigate} from "~/client/remix/use_navigate";
import {useSpaceContext} from "~/client/spaces/space_context";
import {SpaceLayoutTopBarCreateButton} from "~/client/spaces/space_layout_top_bar_create_button";
import {MyAccountProtocol} from "~/shared/accounts/my_account_protocol";
import {spacing} from "~/shared/design/spacing";
import {DynamoGeneralRealtimeItem} from "~/shared/dynamo/dynamo_general_realtime_types";
import {UnimplementedError} from "~/shared/error/error";
import {errorDisplayMessage} from "~/shared/error/error_display_message";
import {InboxModel} from "~/shared/models/inbox_model";
import {SpaceModel} from "~/shared/models/space_model";
import {getInboxWithStrongReadConsistency} from "~/shared/rpc/accounts_rpc_definitions";
import {backgroundColorVar} from "~/shared/styles/styles";

// TODO(calebmer): Keyboard shortcuts for everything in top bar

export function SpaceLayoutTopBar({
    space,
    initialInbox,
}: {
    space: SpaceModel;
    initialInbox: DynamoGeneralRealtimeItem<InboxModel>;
}) {
    const showToast = useShowToast();
    const navigate = useNavigate();
    const isMobile = useIsMobile();

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
                    pressErrorTitle="Can not navigate to home page"
                    onPress={async () => {
                        if (space.alphaAccessDefaultChannelId) {
                            await navigate(
                                `/s/${space.id}/channels/${space.alphaAccessDefaultChannelId}`,
                            );
                        } else {
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
                        }
                    }}
                >
                    <Box fontSize="200" fontStyle="truncate-semi-bold">
                        {space.name}
                    </Box>
                </Button>
            </Box>
            {!isMobile && (
                // NOTE(calebmer): For now the search bar looks whack on mobile. Since it's not
                // even implemented and only used to frame the design, hide it for now.
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
                        gap="1.5"
                        color="grey-50"
                        cursor="text"
                        onClick={() => {
                            showToast({
                                type: "Error",
                                title: "Can not open search",
                                error: new UnimplementedError(
                                    "Search has not been implemented yet",
                                    {
                                        displayMessage: errorDisplayMessage`Search has not been implemented yet.`,
                                    },
                                ),
                            });
                        }}
                    >
                        <MagnifyingGlass size={spacing["3"]} />
                        <Box fontStyle="truncate">Search {space.name}…</Box>
                    </Box>
                </Box>
            )}
            <Box
                width="48"
                display="flex"
                justifyContent="flex-end"
                alignItems="center"
                gap="1"
                paddingX="2"
            >
                <SpaceLayoutTopBarCreateButton />
                <SpaceLayoutTopBarNotificationsButton initialInbox={initialInbox} />
                <Box paddingLeft="1">
                    <SpaceLayoutTopBarAccountButton />
                </Box>
            </Box>
        </Box>
    );
}

function SpaceLayoutTopBarNotificationsButton({
    initialInbox,
}: {
    initialInbox: DynamoGeneralRealtimeItem<InboxModel>;
}) {
    const context = useAppContext();
    const showToast = useShowToast();
    const {space, currentAccount} = useSpaceContext();

    const [inbox, setInbox] = useState(initialInbox);

    // TODO(calebmer): Abstract this!
    const {isConnected} = useWebSocket(
        MyAccountProtocol,
        `/durable-objects/my-account/${currentAccount.id}`,
        event => {
            for (const _event of event.eventTransaction) {
                const event = _event;

                if (event.item.key === inbox.key && event.item.version > inbox.version) {
                    setInbox(event.item);
                }
            }
        },
    );

    // Whenever we connect to realtime, load the inbox item again with a strong
    // read consistency. This way if there were updates to the item between when it
    // was loaded from the server and we connected via realtime we won't miss them
    // because we weren't connected to realtime during that time.
    //
    // NOCOMMIT: Test that we can go offline then back online and the inbox count
    // updates.
    const wasConnectedRef = useRef(isConnected);
    useEffect(() => {
        if (!isConnected) {
            wasConnectedRef.current = false;
            return;
        }

        if (wasConnectedRef.current) return;
        wasConnectedRef.current = true;

        getInboxWithStrongReadConsistency(context, {spaceId: space.id}).then(
            ({inbox: newInbox}) => {
                setInbox(inbox => {
                    if (inbox.key !== newInbox.key || inbox.version >= newInbox.version)
                        return inbox;
                    return newInbox;
                });
            },
            error => {
                context.tracer.getRoot().logUncaughtException("Couldn't backfill inbox", error);
            },
        );
    }, [context, isConnected, space.id]);

    return (
        <Box position="relative" zIndex="0">
            <IconButton
                size="md"
                description="Notifications"
                tooltipPlacement="bottom"
                // The notification count renders outside the bounds of the icon button. Don't
                // clip it!
                disableOverflowHidden={true}
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
                {inbox.model.loudNotificationCount > 0 && (
                    // We use a bright red design for loud notifications. We know this can be
                    // distracting...but that's the point of a loud notification. Someone is
                    // specifically trying to get your attention.
                    <Box
                        zIndex="30"
                        position="absolute"
                        pointerEvents="none"
                        borderRadius="full"
                        style={{
                            lineHeight: 1,
                            fontSize: "0.5rem",
                            top: "-0.0625rem",
                            // Use `right` and `transform` to center the number around a point inset within
                            // the button.
                            right: "0.5rem",
                            transform: "translateX(50%)",
                            boxShadow: `0 0 0 1px ${backgroundColorVar}`,
                        }}
                    >
                        <Box
                            minWidth="3"
                            height="3"
                            paddingX="0.5"
                            display="flex"
                            justifyContent="center"
                            alignItems="center"
                            borderRadius="full"
                            color="grey-0-const"
                            backgroundColor="red-50-const"
                        >
                            {inbox.model.loudNotificationCount > 99
                                ? "99+"
                                : inbox.model.loudNotificationCount}
                        </Box>
                    </Box>
                )}
            </IconButton>
        </Box>
    );
}

function SpaceLayoutTopBarAccountButton() {
    const navigate = useNavigate();
    const {currentAccount} = useSpaceContext();

    return (
        <MenuButton
            placement="bottom-end"
            actions={[
                {
                    label: "Sign out",
                    onPress: () => navigate("/sign-out"),
                },
            ]}
        >
            <IconButton size="md" variant="accent" description="Account" tooltipPlacement="bottom">
                <AccountAvatar account={currentAccount} size="6" />
            </IconButton>
        </MenuButton>
    );
}
