import {Globe, Lock} from "phosphor-react";
import {MenuAction, MenuActions} from "~/client/design/menu.js";
import {BuildingsIcon} from "~/client/icons/buildings_icon.js";
import {NavigationBarShareButtonProps} from "~/client/navigation/navigation_bar_types.js";
import {AccessPolicy} from "~/shared/access/access_policy.js";
import {isReadonlyArray} from "~/shared/helpers/array/is_readonly_array.js";

/**
 * Add a share menu item to the `MenuActions` array. If there's a "Copy link"
 * menu action then want to add the share menu item to the same section.
 */
export function addShareMenuItem({
    accessPolicy,
    actions,
    onShare,
}: {
    accessPolicy: AccessPolicy;
    actions: MenuActions;
    onShare: () => {withoutClose: boolean} | void;
}): MenuActions {
    const shareMenuItem = createShareMenuItem({accessPolicy, onShare});

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

function createShareMenuItem({
    accessPolicy,
    onShare,
}: {
    accessPolicy: AccessPolicy;
    onShare: () => {withoutClose: boolean} | void;
}): MenuAction {
    return {
        label: "Share",
        icon: accessPolicy.urlGrant ? (
            <Globe />
        ) : accessPolicy.defaultGrant ? (
            <BuildingsIcon />
        ) : (
            <Lock />
        ),
        iconPlacement: "end",
        pressErrorTitle: "Couldn’t share",
        onPress: onShare,
    };
}
