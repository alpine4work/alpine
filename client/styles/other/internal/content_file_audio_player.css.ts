import {style} from "@vanilla-extract/css";
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
    width: "100%",
    overflow: "hidden",
    paddingTop: spacing["1.5"],
    paddingBottom: spacing["1.5"],
    paddingLeft: spacing["4"],
    paddingRight: spacing["4"],
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
