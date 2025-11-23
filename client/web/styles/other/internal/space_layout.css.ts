import {globalStyle, style} from "@vanilla-extract/css";
import {colorSchemeVars} from "~/client/web/styles/core/styles_core.js";
import {contentMaxWidth} from "~/client/web/styles/other/internal/content.css.js";
import {RemLength, parseRemLength} from "~/shared/design/core/spacing.js";
import {createObjectFromKeys} from "~/shared/helpers/object/create_object_from_keys.js";

export const sideBarWidth: RemLength = "3.5rem";
const sideBarWidthRem = parseRemLength(sideBarWidth);

const containerWidthForMaxSideBarSpaceRem =
    parseRemLength(contentMaxWidth) +
    parseRemLength("96") + // Should be the same as `documentContentEditorSidebarWidth`
    parseRemLength("48");

const maxSideBarSpaceRem = sideBarWidthRem;

const containerWidthForMinSideBarSpaceRem = containerWidthForMaxSideBarSpaceRem + sideBarWidthRem;

const minSideBarSpaceRem = 0;

const sideBarSpaceByContainerWidthRem =
    (minSideBarSpaceRem - maxSideBarSpaceRem) /
    (containerWidthForMinSideBarSpaceRem - containerWidthForMaxSideBarSpaceRem);

/**
 * The space actually occupied by our space layout sidebar.
 *
 * On large screens we want to allocate 0 space for the sidebar. This will
 * cause content to be visually centered on the screen ignoring space from the
 * sidebar. But on smaller screens we need the sidebar to take up space in our
 * layout so we don't end up rendering content underneath the sidebar.
 *
 * This `calc()` expression calculates the amount of space to allocate the
 * sidebar based on the container width.
 */
export const sideBarSpace = `clamp(${minSideBarSpaceRem}rem, ${maxSideBarSpaceRem}rem + (100vw - ${containerWidthForMaxSideBarSpaceRem}rem) * ${sideBarSpaceByContainerWidthRem}, ${maxSideBarSpaceRem}rem)`;

export const webMobileTabs = ["Home", "Search", "Create", "Inbox", "More"] as const;

export const selectedClassNameByTab = createObjectFromKeys(webMobileTabs, tab => {
    const className = style({});

    globalStyle(`${className} [data-tab=${tab}]`, {
        color: colorSchemeVars["grey-100"],
    });

    return className;
});
