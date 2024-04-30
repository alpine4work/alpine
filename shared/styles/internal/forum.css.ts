import {style} from "@vanilla-extract/css";
import {spacing} from "~/shared/design/spacing.js";

export const fullScreenContentEditorClassName = style({
    paddingBottom: `calc(${spacing["6"]} + var(--safe-area-inset-bottom, 0px))`,
});
