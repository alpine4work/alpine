import {globalStyle, style} from "@vanilla-extract/css";
import {sprinkles} from "~/client/styles/core/styles_core.js";

export const pointerEventsNoneNotInheritedClassName = style({
    pointerEvents: "none",
});

const pointerEventsNoneSprinklesNotSelector = sprinkles({pointerEvents: "none"})
    .split(" ")
    .map(className => `:not(.${className})`)
    .join("");

globalStyle(
    `${pointerEventsNoneNotInheritedClassName} > *:not(${pointerEventsNoneNotInheritedClassName})${pointerEventsNoneSprinklesNotSelector}`,
    {
        pointerEvents: "initial",
    },
);

export const withoutClearSelectionOnMouseDownClassName = style({});
