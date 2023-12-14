// Ideally each of these files would live next to the component that uses them.
// However, Remix doesn't have support for `vanilla-extract` at the moment so
// as a workaround all styles need to be exported from a single entrypoint.
//
// We build this file as `~/shared/styles/styles.js` and
// `~/shared/styles/styles.css`. The JavaScript file has the real runtime
// interface, the CSS file is the styles we include in our root layout, and we
// have a `~/shared/styles/styles.d.ts` file that re-exports this file for
// TypeScript.

import "~/shared/styles/internal/global/global_1_reset.css.js";
import "~/shared/styles/internal/global/global_2_defaults.css.js";

export * from "~/shared/styles/internal/animation.css.js";
export * from "~/shared/styles/internal/border_radius.css.js";
export * from "~/shared/styles/internal/button.css.js";
export * from "~/shared/styles/internal/color_scheme.css.js";
export * as contentEditorStyles from "~/shared/styles/internal/content_editor.css.js";
export * as contentSchemaStyles from "~/shared/styles/internal/content_schema.css.js";
export * as contentViewStyles from "~/shared/styles/internal/content_view.css.js";
export * as documentBlobsStyles from "~/shared/styles/internal/document_blobs.css.js";
export * from "~/shared/styles/internal/fonts.css.js";
export * from "~/shared/styles/internal/input_placeholder.css.js";
export * as modalStyles from "~/shared/styles/internal/modal.css.js";
export * from "~/shared/styles/internal/overlay_animated.css.js";
export * from "~/shared/styles/internal/press_opacity_overlay.css.js";
export * from "~/shared/styles/internal/scrollbar.css.js";
export * from "~/shared/styles/internal/sprinkles.css.js";
export * as tasksStyles from "~/shared/styles/internal/tasks.css.js";
export * as toastStyles from "~/shared/styles/internal/toast.css.js";
export * from "~/shared/styles/internal/wiggle_animation.css.js";
