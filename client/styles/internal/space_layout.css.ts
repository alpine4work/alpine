import {globalStyle, style} from "@vanilla-extract/css";
import {colorSchemeVars} from "~/client/styles/internal/color_scheme.css.js";
import {RemLength} from "~/shared/design/spacing.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";

export const sideBarWidth: RemLength = "3.5rem";

export const webMobileTabs = ["Home", "Search", "Create", "Inbox", "More"] as const;

export const selectedClassNameByTab = createObjectFromKeys(webMobileTabs, tab => {
    const className = style({});

    globalStyle(`${className} [data-tab=${tab}]`, {
        color: colorSchemeVars["grey-100"],
    });

    return className;
});
