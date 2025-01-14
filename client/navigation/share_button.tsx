import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {OverlayTriggerButton} from "~/client/design/overlay_trigger_button.js";
import {useReporter} from "~/client/design/reporter.js";
import {BuildingsIcon} from "~/client/icons/buildings_icon.js";
import {ShareOverlay} from "~/client/navigation/internal/share_overlay.js";
import {useExpensivelyPreloadAllSpaceAccounts} from "~/client/spaces/use_expensively_load_all_space_accounts.js";
import {elevation} from "~/client/styles/styles.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {InternalError, UnimplementedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";

// NOCOMMIT: Implement toggle button
export function ShareButton({
    entityNoun,
    accessPolicy,
    onAccessPolicyChange: onAccessPolicyChangeProp,
    isReadOnly,
    onCopyLink,
}: {
    entityNoun: string;
    accessPolicy: AccessPolicy;
    onAccessPolicyChange: (accessPolicy: AccessPolicy) => void;
    isReadOnly: boolean;
    onCopyLink: () => MaybePromise<void>;
}) {
    const reporter = useReporter();

    // We need all accounts when the `<ShareOverlay>` is open so preload
    // them now.
    useExpensivelyPreloadAllSpaceAccounts();

    const onAccessPolicyChange = (accessPolicy: AccessPolicy) => {
        // Defend against making changes while read only. Ultimately the backend should
        // prevent invalid changes like this but it's nice to catch errors like this
        // early.
        if (isReadOnly) {
            throw new InternalError("Can't update access policy when share button is read only");
        }

        onAccessPolicyChangeProp(accessPolicy);
    };

    return (
        <Box display="flex" alignItems="center" gap="1.5">
            <OverlayTriggerButton
                aria-haspopup="dialog"
                placement="bottom"
                offset="3"
                overlay={({isVisible, onCloseWithoutAnimation}) => (
                    <Box paddingX="3">
                        <ShareOverlay
                            entityNoun={entityNoun}
                            accessPolicy={accessPolicy}
                            onAccessPolicyChange={onAccessPolicyChange}
                            isVisible={isVisible}
                            isReadOnly={isReadOnly}
                            onCopyLink={onCopyLink}
                            onCloseWithoutAnimation={onCloseWithoutAnimation}
                        />
                    </Box>
                )}
                onOverlayEscapeGlobalKeyDown={event => {
                    // If the focused element is a combobox input, `<MenuButton>`, or menu item
                    // that's open and the user hits escape then we want the escape keydown to close
                    // the focused element's overlay.
                    if (
                        event.target instanceof HTMLElement &&
                        (event.target.getAttribute("aria-expanded") === "true" ||
                            event.target.role === "menuitem")
                    ) {
                        return {allowDefault: true};
                    }
                }}
                onOverlayTabGlobalKeyDown={() => {
                    // Don't close the overlay when tab is pressed. Tab is needed to navigate
                    // internally within the share overlay.
                    return {allowDefault: true};
                }}
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
