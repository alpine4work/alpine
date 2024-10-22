import stylesUrl from "~/client/styles/styles.css?url";

export {stylesUrl};

// Make sure we hot reload when the CSS changes. Vite or Remix seem to handle
// hot reloading the CSS file for us. Cool!
import.meta.hot?.accept();
