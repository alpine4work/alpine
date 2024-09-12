// Ideally each of these files would live next to the component that uses them.
// However, Remix doesn't have support for `vanilla-extract` at the moment so
// as a workaround all styles need to be exported from a single entrypoint.
//
// We build this file as `~/client/styles/styles.js` and
// `~/client/styles/styles.css`. The JavaScript file has the real runtime
// interface, the CSS file is the styles we include in our root layout, and we
// have a `~/client/styles/styles.d.ts` file that re-exports this file for
// TypeScript.

// ProseMirror includes some lightweight styling that's required for the editor
// to work correctly.
import "prosemirror-view/style/prosemirror.css";

import "~/client/styles/internal/global/global_1_reset.css.js";
import "~/client/styles/internal/global/global_2_defaults.css.js";

export * from "~/client/styles/internal/animation.css.js";
export * from "~/client/styles/internal/border_radius.css.js";
export * as buttonStyles from "~/client/styles/internal/button.css.js";
export * from "~/client/styles/internal/color_scheme.css.js";
export * as contentEditorStyles from "~/client/styles/internal/content_editor.css.js";
export * as contentViewStyles from "~/client/styles/internal/content_view.css.js";
export * as contentStyles from "~/client/styles/internal/content.css.js";
export * as documentBlobsStyles from "~/client/styles/internal/document_blobs.css.js";
export * as documentCommentThreadsStyles from "~/client/styles/internal/document_comment_threads.css.js";
export * as documentContentStyles from "~/client/styles/internal/document_content.css.js";
export * from "~/client/styles/internal/elevation.css.js";
export * from "~/client/styles/internal/fonts.css.js";
export * as forumStyles from "~/client/styles/internal/forum.css.js";
export * as inboxStyles from "~/client/styles/internal/inbox.css.js";
export * from "~/client/styles/internal/input_placeholder.css.js";
export * as messagingStyles from "~/client/styles/internal/messaging.css.js";
export * as modalStyles from "~/client/styles/internal/modal.css.js";
export * as navigationBarStyles from "~/client/styles/internal/navigation_bar.css.js";
export * from "~/client/styles/internal/pointer_events.css.js";
export * from "~/client/styles/internal/overlay_animated.css.js";
export * from "~/client/styles/internal/platform.css.js";
export * from "~/client/styles/internal/press_opacity_overlay.css.js";
export * as scrollbarStyles from "~/client/styles/internal/scrollbar.css.js";
export * as searchStyles from "~/client/styles/internal/search.css.js";
export * as spaceLayoutStyles from "~/client/styles/internal/space_layout.css.js";
export * from "~/client/styles/internal/sprinkles.css.js";
export * as tasksStyles from "~/client/styles/internal/tasks.css.js";
export * as toastStyles from "~/client/styles/internal/toast.css.js";
export * from "~/client/styles/internal/wiggle_animation.css.js";
