import {convertRemLengthToPx, spacing} from "~/shared/design/core/spacing.js";
import {SpacingScale} from "~/shared/design/core/spacing_scale.js";
import {mapObjectValues} from "~/shared/helpers/object/map_object_values.js";

export const emailSpacingScale: SpacingScale = "large";

export const emailSpacing = mapObjectValues(spacing, value =>
    convertRemLengthToPx(value, emailSpacingScale),
);
