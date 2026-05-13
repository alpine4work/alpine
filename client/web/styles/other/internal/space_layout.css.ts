import {globalStyle, style} from "@vanilla-extract/css";
import {colorSchemeVars} from "~/client/web/styles/core/styles_core.js";
import {RemLength} from "~/shared/design/core/spacing.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";

// When there's a spacing scale mismatch between SSR and client, show a white
// overlay to hide the layout shift until the client renders with the correct
// spacing scale. This overlay is added by the inline spacing scale script and
// removed by the spacing scale context provider.
globalStyle("html[data-spacing-mismatch]::before", {
    content: '""',
    position: "fixed",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: colorSchemeVars["grey-0"],
    zIndex: 9999,
});

export const sideBarWidth: RemLength = "3.5rem";

export const webMobileTabs = ["Home", "Search", "Create", "Inbox", "More"] as const;

export const selectedClassNameByTab = createObjectFromKeys(webMobileTabs, tab => {
    const className = style({});

    globalStyle(`${className} [data-tab=${tab}]`, {
        color: colorSchemeVars["grey-100"],
    });

    return className;
});
