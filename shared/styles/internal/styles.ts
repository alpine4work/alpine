// Ideally each of these files would live next to the component that uses them.
// However, Remix doesn't have support for `vanilla-extract` at the moment so
// as a workaround all styles need to be exported from a single entrypoint.
//
// We build this file as `~/shared/styles/styles.js` and
// `~/shared/styles/styles.css`. The JavaScript file has the real runtime
// interface, the CSS file is the styles we include in our root layout, and we
// have a `~/shared/styles/styles.d.ts` file that re-exports this file for
// TypeScript.

import "~/shared/styles/internal/global/global_1_reset.css";
import "~/shared/styles/internal/global/global_2_defaults.css";

export * from "~/shared/styles/internal/animation.css";
export * from "~/shared/styles/internal/border_radius.css";
export * from "~/shared/styles/internal/color_scheme.css";
export * as contentEditorStyles from "~/shared/styles/internal/content_editor.css";
export * as contentSchemaStyles from "~/shared/styles/internal/content_schema.css";
export * as contentViewStyles from "~/shared/styles/internal/content_view.css";
export * as documentBlobsStyles from "~/shared/styles/internal/document_blobs.css";
export * as documentCommentThreadPreviewStyles from "~/shared/styles/internal/document_comment_thread_preview.css";
export * from "~/shared/styles/internal/fonts.css";
export * from "~/shared/styles/internal/hide_scrollbar.css";
export * from "~/shared/styles/internal/input_placeholder_color.css";
export * as modalStyles from "~/shared/styles/internal/modal.css";
export * from "~/shared/styles/internal/overlay_animated.css";
export * from "~/shared/styles/internal/peek.css";
export * from "~/shared/styles/internal/sprinkles.css";
export * as toastStyles from "~/shared/styles/internal/toast.css";
export * from "~/shared/styles/internal/wiggle_animation.css";
