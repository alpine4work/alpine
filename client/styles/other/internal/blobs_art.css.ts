import {globalStyle} from "@vanilla-extract/css";

export const containerClassName = process.env.NODE_ENV !== "production" ? "blobs_container" : "b_c";
globalStyle(`.${containerClassName}`, {
    zIndex: -50,
    position: "absolute",
    marginInline: "auto",
    left: 0,
    right: 0,
    top: 0,
    bottom: 0,
});

/** This classname is also used as an identifier for drawing the gradient */
export const gradientClassName = process.env.NODE_ENV !== "production" ? "blobs_gradient" : "b_g";
globalStyle(`.${gradientClassName}`, {
    position: "absolute",
    inset: 0,
});
