import {globalStyle, style} from "@vanilla-extract/css";
import {colorSchemeVars, fontSizes, fontStyles} from "~/client/styles/core/styles_core.js";
import {spacing} from "~/shared/design/core/spacing.js";

export const containerClassName = style({
    width: "100%",
    height: "100%",
    display: "flex",
    flexDirection: "column",
    backgroundColor: colorSchemeVars["grey-0"],
});

export const visualizationClassName = style({
    flexGrow: "1",
    display: "flex",
    flexDirection: "column",
    justifyContent: "center",
    paddingTop: spacing["4"],
    paddingLeft: spacing["4"],
    paddingRight: spacing["4"],
    // Don't allow item to grow beyond flexbox bounds. By default flexbox items
    // have `min-width: auto` which extends with content.
    // https://stackoverflow.com/a/66689926/1568890
    minWidth: 0,
});

globalStyle(`${visualizationClassName} > svg`, {
    width: "fit-content",
    maxWidth: "100%",
    fill: colorSchemeVars["theme-50"],
});

export const controlsContainerClassName = style({
    flexShrink: "0",
    width: "100%",
    padding: spacing["1"],
    paddingRight: spacing["2"],
    pointerEvents: "all",
    cursor: "default",
});

export const metadataClassName = style({
    flexShrink: "0",
    width: "100%",
    overflow: "hidden",
    paddingTop: spacing["1.5"],
    paddingBottom: spacing["1.5"],
    paddingLeft: spacing["4"],
    paddingRight: spacing["4"],
    display: "flex",
    alignItems: "center",
});

export const metadataWithoutVisualizationClassName = style({
    flexGrow: "1",
});

export const metadataIconClassName = style({
    flexShrink: "0",
    marginRight: spacing["3"],
    width: spacing["5"],
    height: spacing["5"],
    color: colorSchemeVars["grey-70"],
});

export const metadataContentClassName = style({
    // Don't allow item to grow beyond flexbox bounds. By default flexbox items
    // have `min-width: auto` which extends with content.
    // https://stackoverflow.com/a/66689926/1568890
    minWidth: 0,
});

export const metadataTitleClassName = style({
    ...fontSizes["300"],
    ...fontStyles["truncate-semi-bold"],
});

export const metadataArtistClassName = style({
    ...fontSizes["75"],
    ...fontStyles["truncate"],
    color: colorSchemeVars["grey-80"],
});
