import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {MenuAction, MenuActions} from "~/client/design/menu.js";
import {Reporter, useReporter} from "~/client/design/reporter.js";
import {BuildingsIcon} from "~/client/icons/buildings_icon.js";
import {elevation} from "~/client/styles/styles.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {UnimplementedError} from "~/shared/error/error.js";
import {errorDisplayMessage} from "~/shared/error/error_display_message.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";

/**
 * Add a share menu item to the `MenuActions` array. If there's a "Copy link"
 * menu action then want to add the share menu item to the same section.
 */
export function addShareMenuItem(reporter: Reporter, actions: MenuActions): MenuActions {
    const shareMenuItem = createShareMenuItem(reporter);

    if (
        !isReadonlyArray(actions[0]) &&
        !actions[0]?.withCustomLayout &&
        actions[0]?.label === "Copy link"
    ) {
        return [[shareMenuItem, actions[0]], ...actions.slice(1)];
    } else if (
        isReadonlyArray(actions[0]) &&
        !actions[0][0]?.withCustomLayout &&
        actions[0][0]?.label === "Copy link"
    ) {
        return [[shareMenuItem, ...actions[0]], ...actions.slice(1)];
    }

    return [[shareMenuItem], ...actions];
}

function createShareMenuItem(reporter: Reporter): MenuAction {
    return {
        label: "Share",
        icon: <BuildingsIcon />,
        iconPlacement: "end",
        onPress: () => {
            reporter.displayError(
                "Can’t share document",
                new UnimplementedError("Sharing documents hasn't been implemented yet", {
                    displayMessage: errorDisplayMessage`Sharing documents hasn’t been implemented yet.`,
                }),
            );
        },
    };
}

export function ShareButton() {
    const reporter = useReporter();

    return (
        <Box display="flex" alignItems="center" gap="1.5">
            <Button
                height="6"
                paddingX="2"
                onPress={() => {
                    reporter.displayError(
                        "Can’t share document",
                        new UnimplementedError("Sharing documents hasn't been implemented yet", {
                            displayMessage: errorDisplayMessage`Sharing documents hasn’t been implemented yet.`,
                        }),
                    );
                }}
            >
                Share
            </Button>
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
