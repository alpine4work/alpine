// We build this file as `~/client/styles/styles_core.js` and
// `~/client/styles/styles_core.css`. The JavaScript file has the real runtime
// interface, the CSS file is the styles we include in our root layout, and we
// have a `~/client/styles/styles_core.d.ts` file that re-exports this file for
// TypeScript.

import "~/client/web/styles/core/internal/helpers/register_constant_class_names.js";

// eslint-disable-next-line cyberworlds/sort-imports-by-source
import "~/client/web/styles/core/internal/global_1_reset.css.js";
import "~/client/web/styles/core/internal/global_2_defaults.css.js";

export * from "~/client/web/styles/core/internal/color_scheme.css.js";
export * from "~/client/web/styles/core/internal/elevation.css.js";
export * from "~/client/web/styles/core/internal/fonts.css.js";
export * from "~/client/web/styles/core/internal/input_placeholder.css.js";
export * from "~/client/web/styles/core/internal/selectors.css.js";
export * from "~/client/web/styles/core/internal/sprinkles.css.js";
