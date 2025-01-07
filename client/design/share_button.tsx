import {CaretDown, Globe, Link as LinkIcon} from "phosphor-react";
import {AccountAvatar} from "~/client/accounts/account_avatar.js";
import {useAccountModel} from "~/client/accounts/account_client_store_context.js";
import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {MenuButton} from "~/client/design/menu_button.js";
import {OverlayTriggerButton} from "~/client/design/overlay_trigger_button.js";
import {useReporter} from "~/client/design/reporter.js";
import {Spacer} from "~/client/design/spacer.js";
import {BuildingsIcon} from "~/client/icons/buildings_icon.js";
import {SpaceAvatar} from "~/client/spaces/space_avatar.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {
    elevation,
    greyElevated1ClassName,
    inputPlaceholderStyles,
    sprinkles,
} from "~/client/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";

export function ShareButton() {
    const reporter = useReporter();

    return (
        <Box display="flex" alignItems="center" gap="1.5">
            <OverlayTriggerButton
                aria-haspopup="dialog"
                placement="bottom"
                offset="3"
                overlay={
                    <Box>
                        <ShareButtonOverlay />
                    </Box>
                }
            >
                <Button height="6" paddingX="2">
                    Share
                </Button>
            </OverlayTriggerButton>
            <Box
                width="12"
                backgroundColor={{light: "theme-40-const", dark: "theme-50-const"}}
                borderRadius="full"
                overflow="hidden"
                style={{
                    // We want our switch knob to be spacing 6 size (to match the size of a `md`
                    // `<IconButton>` and fit a size 4 icon). But we also want 2px of color around
                    // the knob to make it feel like the knob is inset into the switch's well. So
                    // take 2px of size away from the knob and add 2px of size to the switch well
                    // so in total the knob is 4px smaller than the well giving us our border.
                    height: `calc(${spacing["6"]} + 2px)`,
                    margin: -1,
                }}
                onClick={() => {
                    reporter.displayError(
                        "Can’t share document",
                        new UnimplementedError("Sharing documents hasn't been implemented yet", {
                            displayMessage: errorDisplayMessage`Sharing documents hasn’t been implemented yet.`,
                        }),
                    );
                }}
            >
                <Box
                    borderRadius="full"
                    style={{
                        width: `calc(${spacing["6"]} + 2px)`,
                        height: `calc(${spacing["6"]} + 2px)`,
                        padding: 2,
                        transform: `translateX(calc(${spacing["6"]} - 2px))`,
                    }}
                >
                    <Box
                        backgroundColor="grey-0-const"
                        borderRadius="full"
                        display="flex"
                        justifyContent="center"
                        alignItems="center"
                        color="grey-70-const"
                        style={{
                            width: `calc(${spacing["6"]} - 2px)`,
                            height: `calc(${spacing["6"]} - 2px)`,
                            boxShadow: `${elevation["elevation-10"].light}`,
                        }}
                    >
                        <BuildingsIcon size={spacing["4"]} />
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}

const manageAccessLevelText = "can edit";
const editAccessLevelText = "can edit (can’t share)";
const commentAccessLevelText = "can comment";
const viewAccessLevelText = "can view";
const noAccessLevelText = "can’t access";
const removeAccessLevelText = "remove access";

function ShareButtonOverlay() {
    const {space, currentAccount} = useSpaceContext();

    return (
        <Box
            className={greyElevated1ClassName}
            backgroundColor="grey-0"
            borderRadius="2.5"
            boxShadow="elevation-20"
            marginX="2"
            width="96"
            padding="5"
        >
            <Box
                padding="2"
                display="flex"
                alignItems="center"
                gap="2"
                border="grey-20"
                borderRadius="1.5"
            >
                <Box paddingLeft="1" flexGrow="1" style={inputPlaceholderStyles}>
                    Add people
                </Box>
                <MenuButton
                    placement="bottom-end"
                    actions={[
                        {
                            label: manageAccessLevelText,
                            isSelected: true,
                            onPress: () => {
                                // NOCOMMIT
                            },
                        },
                        {
                            // NOCOMMIT: Hide this behind alt key?
                            label: editAccessLevelText,
                            onPress: () => {
                                // NOCOMMIT
                            },
                        },
                        {
                            label: commentAccessLevelText,
                            onPress: () => {
                                // NOCOMMIT
                            },
                        },
                        {
                            label: viewAccessLevelText,
                            onPress: () => {
                                // NOCOMMIT
                            },
                        },
                    ]}
                >
                    <Button height="6" paddingX="2" icon={<CaretDown />} iconPlacement="end">
                        {manageAccessLevelText}
                    </Button>
                </MenuButton>
                <Button variant="neutral" height="6" paddingX="3" withoutMinWidth>
                    Add
                </Button>
            </Box>
            <Spacer space="4" />
            <Box display="flex" alignItems="center" gap="2.5">
                <AccountAvatar size="6" account={currentAccount} />
                <Box fontSize="100" fontStyle="truncate-semi-bold">
                    {useAccountModel(currentAccount).name}
                </Box>
                <Box flexGrow="1" />
                <MenuButton
                    placement="bottom-end"
                    actions={[
                        [
                            {
                                label: manageAccessLevelText,
                                isSelected: true,
                                onPress: () => {
                                    // NOCOMMIT
                                },
                            },
                            {
                                // NOCOMMIT: Hide this behind alt key?
                                label: editAccessLevelText,
                                onPress: () => {
                                    // NOCOMMIT
                                },
                            },
                            {
                                label: commentAccessLevelText,
                                onPress: () => {
                                    // NOCOMMIT
                                },
                            },
                            {
                                label: viewAccessLevelText,
                                onPress: () => {
                                    // NOCOMMIT
                                },
                            },
                        ],
                        [
                            {
                                label: removeAccessLevelText,
                                onPress: () => {
                                    // NOCOMMIT
                                },
                            },
                        ],
                    ]}
                >
                    <Button height="6" paddingX="2" icon={<CaretDown />} iconPlacement="end">
                        {manageAccessLevelText}
                    </Button>
                </MenuButton>
            </Box>
            <Spacer space="4" />
            <Box height="border" backgroundColor="grey-5" />
            <Spacer space="4" />
            <Box display="flex" alignItems="center">
                <SpaceAvatar size="6" space={space} />
                <Spacer space="2.5" />
                <Box fontStyle="truncate" color="grey-80">
                    Everyone in{" "}
                    <span className={sprinkles({color: "grey-90", fontStyle: "semi-bold"})}>
                        {space.name}
                    </span>
                </Box>
                <Box flexGrow="1" minWidth="2" />
                <MenuButton
                    placement="bottom-end"
                    actions={[
                        [
                            {
                                label: manageAccessLevelText,
                                onPress: () => {
                                    // NOCOMMIT
                                },
                            },
                            {
                                // NOCOMMIT: Hide this behind alt key?
                                label: editAccessLevelText,
                                onPress: () => {
                                    // NOCOMMIT
                                },
                            },
                            {
                                label: commentAccessLevelText,
                                onPress: () => {
                                    // NOCOMMIT
                                },
                            },
                            {
                                label: viewAccessLevelText,
                                onPress: () => {
                                    // NOCOMMIT
                                },
                            },
                        ],
                        [
                            {
                                label: noAccessLevelText,
                                isSelected: true,
                                onPress: () => {
                                    // NOCOMMIT
                                },
                            },
                        ],
                    ]}
                >
                    <Button
                        variant="quieter"
                        height="6"
                        paddingX="2"
                        icon={<CaretDown />}
                        iconPlacement="end"
                    >
                        {noAccessLevelText}
                    </Button>
                </MenuButton>
            </Box>
            <Spacer space="3" />
            <Box display="flex" alignItems="center">
                <Box
                    width="6"
                    height="6"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    color="grey-70"
                >
                    <Globe size={spacing["6"]} weight="light" />
                </Box>
                <Spacer space="2.5" />
                <Box fontStyle="truncate" color="grey-80">
                    Anyone with the link
                </Box>
                <Box flexGrow="1" minWidth="2" />
                <MenuButton
                    placement="bottom-end"
                    actions={[
                        [
                            {
                                label: viewAccessLevelText,
                                onPress: () => {
                                    // NOCOMMIT
                                },
                            },
                        ],
                        [
                            {
                                label: noAccessLevelText,
                                isSelected: true,
                                onPress: () => {
                                    // NOCOMMIT
                                },
                            },
                        ],
                    ]}
                >
                    <Button
                        variant="quieter"
                        height="6"
                        paddingX="2"
                        icon={<CaretDown />}
                        iconPlacement="end"
                    >
                        {noAccessLevelText}
                    </Button>
                </MenuButton>
            </Box>
            <Spacer space="4" />
            <Box height="border" backgroundColor="grey-5" />
            <Spacer space="5" />
            <Button
                variant="accent"
                height="8"
                fullWidth={true}
                borderRadius="1.5"
                icon={<LinkIcon size={spacing["4"]} />}
                onPress={() => {
                    // NOCOMMIT: Implement
                }}
            >
                Copy link
            </Button>
        </Box>
    );
}
