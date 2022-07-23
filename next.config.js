"use strict";

module.exports = {
    // Require pages to include `.page` in the extension. This serves a couple
    // purposes:
    //
    // 1. It’s pretty clear when you’re exposing code to the open internet.
    // 2. Easier to globally search for page files.
    // 3. Allows non-page files in the `pages` directory like tests.
    //
    // In general, try to put non-page code in `frontend`, `backend`, or `shared`.
    // Avoids potential security concerns where non-page code is accessible to
    // the public internet.
    pageExtensions: ["tsx", "ts", "jsx", "js"].map(ext => `page.${ext}`),

    poweredByHeader: false,
    reactStrictMode: true,
    swcMinify: true,
};
