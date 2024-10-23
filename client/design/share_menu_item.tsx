import {MenuAction, MenuActions} from "~/client/design/menu.js";
import {Reporter} from "~/client/design/reporter.js";
import {BuildingsIcon} from "~/client/icons/buildings_icon.js";
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
