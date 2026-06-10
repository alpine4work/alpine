// ProseMirror includes some lightweight styling that's required for the editor to
// work correctly.
//
// Can't import `.css` files in a `.css.ts` file so we have this integration `.ts`
// file to pull it into our styles bundle.
import "prosemirror-view/style/prosemirror.css";

export * from "~/client/web/styles/core/internal/styles_core.css.js";
