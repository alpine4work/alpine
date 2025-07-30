import {style} from "@vanilla-extract/css";
import {sprinkles} from "~/client/styles/core/styles_core.js";
import {spacing} from "~/shared/design/core/spacing.js";

export const fullScreenContentEditorClassName = style({
    paddingBottom: `calc(${spacing["24"]} + var(--safe-area-inset-bottom, 0px))`,
});

export const postHeaderAuthorAndChannelClassName = sprinkles({
    fontSize: "75",
    fontStyle: "truncate",
    color: "grey-70",
});

export const postHeaderAuthorClassName = sprinkles({
    fontStyle: "semi-bold",
    color: "grey-100",
});

export const postHeaderCreatedTimeClassName = sprinkles({
    fontSize: "50",
    fontStyle: "truncate",
    color: "grey-50",
});
