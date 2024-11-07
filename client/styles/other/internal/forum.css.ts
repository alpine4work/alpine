import {style} from "@vanilla-extract/css";
import {spacing} from "~/shared/design/core/spacing.js";

export const fullScreenContentEditorClassName = style({
    paddingBottom: `calc(${spacing["24"]} + var(--safe-area-inset-bottom, 0px))`,
});
