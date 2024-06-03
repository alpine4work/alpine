// Ideally each of these files would live next to the component that uses them.
// However, Remix doesn't have support for `vanilla-extract` at the moment so
// as a workaround all styles need to be exported from a single entrypoint.
//
// We build this file as `~/shared/styles/styles.js` and
// `~/shared/styles/styles.css`. The JavaScript file has the real runtime
// interface, the CSS file is the styles we include in our root layout, and we
// have a `~/shared/styles/styles.d.ts` file that re-exports this file for
// TypeScript.

// ProseMirror includes some lightweight styling that's required for the editor
// to work correctly.
import "prosemirror-view/style/prosemirror.css";

import "~/shared/styles/internal/global/global_1_reset.css.js";
import "~/shared/styles/internal/global/global_2_defaults.css.js";

export * from "~/shared/styles/internal/animation.css.js";
export * from "~/shared/styles/internal/border_radius.css.js";
export * as buttonStyles from "~/shared/styles/internal/button.css.js";
export * from "~/shared/styles/internal/color_scheme.css.js";
export * as contentEditorStyles from "~/shared/styles/internal/content_editor.css.js";
export * as contentSchemaStyles from "~/shared/styles/internal/content_schema.css.js";
export * as contentViewStyles from "~/shared/styles/internal/content_view.css.js";
export * as documentBlobsStyles from "~/shared/styles/internal/document_blobs.css.js";
export * as documentCommentThreadsStyles from "~/shared/styles/internal/document_comment_threads.css.js";
export * as documentContentStyles from "~/shared/styles/internal/document_content.css.js";
export * from "~/shared/styles/internal/elevation.css.js";
export * from "~/shared/styles/internal/fonts.css.js";
export * as forumStyles from "~/shared/styles/internal/forum.css.js";
export * as inboxStyles from "~/shared/styles/internal/inbox.css.js";
export * from "~/shared/styles/internal/input_placeholder.css.js";
export * as messagingStyles from "~/shared/styles/internal/messaging.css.js";
export * as modalStyles from "~/shared/styles/internal/modal.css.js";
export * as navigationBarStyles from "~/shared/styles/internal/navigation_bar.css.js";
export * from "~/shared/styles/internal/pointer_events.css.js";
export * from "~/shared/styles/internal/overlay_animated.css.js";
export * from "~/shared/styles/internal/press_opacity_overlay.css.js";
export * as scrollbarStyles from "~/shared/styles/internal/scrollbar.css.js";
export * as searchStyles from "~/shared/styles/internal/search.css.js";
export * as spaceLayoutStyles from "~/shared/styles/internal/space_layout.css.js";
export * from "~/shared/styles/internal/sprinkles.css.js";
export * as tasksStyles from "~/shared/styles/internal/tasks.css.js";
export * as toastStyles from "~/shared/styles/internal/toast.css.js";
export * from "~/shared/styles/internal/wiggle_animation.css.js";
