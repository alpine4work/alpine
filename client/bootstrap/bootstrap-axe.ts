/*!
 * Initialize [axe][1] which is an automated accessibility tester.
 * Accessibility violations are printed to the console.
 *
 * [1]: https://github.com/dequelabs/axe-core-npm
 */

import React from "react";
import ReactDom from "react-dom";

if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
    import("@axe-core/react").then(({default: axe}) => {
        axe(React, ReactDom, 1000);
    });
}
