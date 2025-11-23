import stylesUrl from "~/client/web/styles/styles.css?url";

export {stylesUrl};

// Accept hot reload changes. Remix and Vite seem to hot reload the CSS for us,
// nice. By accepting here we stop full page reloads when styles change. Since
// this file is imported by `entry.server.tsx` which will reload the page when
// updated.
import.meta.hot?.accept();
