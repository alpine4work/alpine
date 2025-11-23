import {globalStyle, style} from "@vanilla-extract/css";
import {blobsArtGradientClassName} from "~/shared/design/core/constant_class_names.js";

export const containerClassName = style({
    zIndex: -50,
    position: "absolute",
    marginInline: "auto",
    inset: 0,
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
    transformOrigin: "top center",
});

export const canvasClassName = style({
    transformOrigin: "top left",
});

globalStyle(`.${blobsArtGradientClassName}`, {
    position: "absolute",
    inset: 0,
    width: "100%",
});
