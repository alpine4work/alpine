import {globalStyle, style} from "@vanilla-extract/css";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";
import {colorSchemeVars} from "~/shared/styles/internal/color_scheme.css.js";

export const webMobileTabs = ["Home", "Search", "Create", "Inbox", "More"] as const;

export const selectedClassNameByTab = createObjectFromKeys(webMobileTabs, tab => {
    const className = style({});

    globalStyle(`${className} [data-tab=${tab}]`, {
        color: colorSchemeVars["grey-100"],
    });

    return className;
});
