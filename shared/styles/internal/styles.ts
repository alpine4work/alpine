// Ideally each of these files would live next to the component that uses them.
// However, Remix doesn't have support for `vanilla-extract` at the moment so
// as a workaround all styles need to be exported from a single entrypoint.
//
// We build this file as `~/shared/styles/styles.js` and
// `~/shared/styles/styles.css`. The JavaScript file has the real runtime
// interface, the CSS file is the styles we include in our root layout, and we
// have a `~/shared/styles/styles.d.ts` file that re-exports this file for
// TypeScript.

import "~/shared/styles/internal/global/global-1-reset.css";
import "~/shared/styles/internal/global/global-2-defaults.css";

export * from "~/shared/styles/internal/color-scheme.css";
export * as contentEditorStyles from "~/shared/styles/internal/content-editor.css";
export * as contentSchemaStyles from "~/shared/styles/internal/content-schema.css";
export * from "~/shared/styles/internal/fonts.css";
export * from "~/shared/styles/internal/input-placeholder-color.css";
export * from "~/shared/styles/internal/overlay-animated.css";
export * from "~/shared/styles/internal/sprinkles.css";
