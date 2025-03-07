import {Globe, Lock} from "phosphor-react";
import {useState} from "react";
import {usePress} from "react-aria";
import {Box} from "~/client/design/box.js";
import {FocusRing} from "~/client/design/focus_ring.js";
import {ModalDialog} from "~/client/design/modal_dialog.js";
import {useReporter} from "~/client/design/reporter.js";
import {useIsInitialAppRender} from "~/client/helpers/lifecycle/initial_app_render.js";
import {BuildingsIcon} from "~/client/icons/buildings_icon.js";
import {useSpacingScale} from "~/client/remix/spacing_scale_context.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {elevation, sprinkles} from "~/client/styles/styles.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {AccessPolicyAction} from "~/shared/access/access_policy_action.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.js";

export function ShareSwitch({
    entityNoun,
    accessPolicy,
    onAccessPolicyChange,
    isReadOnly,
}: {
    entityNoun: string;
    accessPolicy: AccessPolicy;
    onAccessPolicyChange: (accessPolicy: AccessPolicyAction) => void;
    isReadOnly: boolean;
}) {
    const isInitialAppRender = useIsInitialAppRender();
    const spacingScale = useSpacingScale();
    const reporter = useReporter();
    const {space} = useSpaceContext();

    const [
        showDeleteDefaultGrantOrUrlGrantConfirmationDialog,
        setShowDeleteDefaultGrantOrUrlGrantConfirmationDialog,
    ] = useState(false);

    const {pressProps, isPressed} = usePress({
        isDisabled: isReadOnly,
        onPress: () => {
            if (!accessPolicy.defaultGrant && !accessPolicy.urlGrant) {
                onAccessPolicyChange({type: "AddDefaultGrant", defaultGrant: {level: "Manage"}});

                reporter.showInfoToast(
                    <>
                        Shared the {entityNoun} with everyone in{" "}
                        <span className={sprinkles({fontStyle: "semi-bold"})}>{space.name}</span>
                    </>,
                    {
                        // This message is short, appears a lot, and the user only really needs to read
                        // it once over the course of their lifetime with the product. Once the user
                        // learns what this switch does (ideally the first time they press the switch)
                        // they don't need to read this message again. So use a fast duration even
                        // though it's not accessible.
                        durationSeconds: 3,
                    },
                );
            } else {
                // Ask the user to confirm when pressing the switch to make the entity private.
                // We want to make it very easy to share the entity but un-sharing the entity
                // should have a little friction so the user doesn't do it accidentally.
                setShowDeleteDefaultGrantOrUrlGrantConfirmationDialog(true);
            }
        },
    });

    const icon = showDeleteDefaultGrantOrUrlGrantConfirmationDialog
        ? // Optimistically show the lock icon while the "make entity private" confirmation dialog
          // is open.
          ("Lock" as const)
        : accessPolicy.urlGrant
        ? ("Globe" as const)
        : accessPolicy.defaultGrant
        ? ("Buildings" as const)
        : ("Lock" as const);

    return (
        <FocusRing>
            <Box
                {...pressProps}
                tabIndex={0}
                role="button"
                aria-label={`Toggle sharing with everyone in ${space.name}`}
                aria-pressed={icon !== "Lock"}
                width="12"
                backgroundColor={
                    {
                        // TODO: If `theme` is green we need a different color for the URL grant. Right
                        // now the theme color is always indigo so hard coding green is fine.
                        Globe: {light: "green-30-const", dark: "green-40-const"} as const,
                        Buildings: {light: "theme-40-const", dark: "theme-50-const"} as const,
                        Lock: {light: "grey-10-const", dark: "grey-50-const"} as const,
                    }[icon]
                }
                borderRadius="full"
                overflow="hidden"
                // We don't normally put cursor pointers on clickable things, but since this UI
                // pattern is a little novel we want to make it really clear to users that this
                // is a clickable switch.
                cursor={!isReadOnly ? "pointer" : undefined}
                style={{
                    // We want our switch knob to be spacing 6 size (to match the size of a `md`
                    // `<IconButton>` and fit a size 4 icon). But we also want 2px of color around
                    // the knob to make it feel like the knob is inset into the switch's well. So
                    // take 2px of size away from the knob and add 2px of size to the switch well
                    // so in total the knob is 4px smaller than the well giving us our border.
                    height: `calc(${spacing["6"]} + 2px)`,
                    margin: -1,
                    transition: !isInitialAppRender ? "background-color 150ms linear" : undefined,
                }}
            >
                <Box
                    borderRadius="full"
                    style={{
                        width: `calc(${spacing["6"]} + 2px)`,
                        height: `calc(${spacing["6"]} + 2px)`,
                        padding: 2,
                        transform:
                            icon !== "Lock" ? `translateX(calc(${spacing["6"]} - 2px))` : undefined,
                        transition: !isInitialAppRender ? "transform 150ms linear" : undefined,
                    }}
                >
                    <Box
                        // Fully remount on `spacingScale` changes so we don't animate the `width`
                        // change.
                        key={spacingScale}
                        position="relative"
                        zIndex="0"
                        overflow="hidden"
                        backgroundColor="grey-0-const"
                        borderRadius="full"
                        color="grey-70-const"
                        style={{
                            height: `calc(${spacing["6"]} - 2px)`,
                            boxShadow: `${elevation["elevation-10"].light}`,
                            width: isPressed
                                ? `calc(${spacing["7"]} - 2px)`
                                : `calc(${spacing["6"]} - 2px)`,
                            transform:
                                isPressed && icon !== "Lock"
                                    ? `translateX(-${spacing["1"]})`
                                    : undefined,
                            // Disable transitions during initial render so we don't animate the `width`
                            // change due to a spacing scale adjustment on initial render.
                            transition: !isInitialAppRender
                                ? "width 50ms linear, transform 50ms linear"
                                : undefined,
                        }}
                    >
                        <Box
                            position="absolute"
                            zIndex="0"
                            inset="0"
                            display="flex"
                            justifyContent="center"
                            alignItems="center"
                            backgroundColor="grey-0-const"
                        >
                            <Lock
                                size={spacing["4"]}
                                role="img"
                                aria-hidden={icon !== "Lock"}
                                aria-label={`Icon indicating the ${entityNoun} is private`}
                            />
                        </Box>
                        <Box
                            position="absolute"
                            zIndex="10"
                            inset="0"
                            display="flex"
                            justifyContent="center"
                            alignItems="center"
                            backgroundColor="grey-0-const"
                            opacity={icon !== "Lock" ? "100" : "0"}
                            style={{
                                transition: !isInitialAppRender
                                    ? "opacity 100ms linear"
                                    : undefined,
                            }}
                        >
                            <BuildingsIcon
                                size={spacing["4"]}
                                role="img"
                                aria-hidden={icon !== "Buildings"}
                                aria-label={`Icon indicating the ${entityNoun} is shared with everyone in ${space.name}`}
                            />
                        </Box>
                        <Box
                            position="absolute"
                            zIndex="20"
                            inset="0"
                            display="flex"
                            justifyContent="center"
                            alignItems="center"
                            backgroundColor="grey-0-const"
                            opacity={icon !== "Lock" && icon !== "Buildings" ? "100" : "0"}
                            style={{
                                transition: !isInitialAppRender
                                    ? "opacity 100ms linear"
                                    : undefined,
                            }}
                        >
                            <Globe
                                size={spacing["4"]}
                                role="img"
                                aria-hidden={icon !== "Globe"}
                                aria-label={`Icon indicating the ${entityNoun} is shared with anyone with the link`}
                            />
                        </Box>
                    </Box>
                </Box>
                {showDeleteDefaultGrantOrUrlGrantConfirmationDialog && (
                    <ModalDialog
                        title={`Make this ${entityNoun} private?`}
                        description={`${
                            accessPolicy.urlGrant
                                ? `Anyone with the link`
                                : `Everyone in ${space.name}`
                        } will no longer be able to access the ${entityNoun}.`}
                        primaryButtonLabel="Confirm"
                        onPrimaryButtonPress={() => {
                            if (!accessPolicy.defaultGrant && !accessPolicy.urlGrant) {
                                // Noop
                            } else if (accessPolicy.defaultGrant && !accessPolicy.urlGrant) {
                                onAccessPolicyChange({type: "DeleteDefaultGrant"});
                            } else if (!accessPolicy.defaultGrant && accessPolicy.urlGrant) {
                                onAccessPolicyChange({type: "DeleteUrlGrant"});
                            } else {
                                assert(accessPolicy.defaultGrant && accessPolicy.urlGrant);
                                onAccessPolicyChange({type: "DeleteDefaultGrantAndUrlGrant"});
                            }
                        }}
                        onClose={() => setShowDeleteDefaultGrantOrUrlGrantConfirmationDialog(false)}
                    />
                )}
            </Box>
        </FocusRing>
    );
}
