// We put styling constants in this file that are needed outside of
// `client/messaging` by packages that don't want to take a dependency on
// `client/messaging`. For example `client/content`.

import {RemLength, Spacing} from "~/shared/design/spacing";

export const messageInputMinHeight: RemLength = "3.5rem";
export const messageViewBubbleBorderRadius = "xl" as const;
export const messageViewBubblePaddingX: Spacing = "0.5";
export const messageViewBubblePaddingY: Spacing = "1.5";
