/*!
 * Initialize [axe][1] which is an automated accessibility tester.
 * Accessibility violations are printed to the console.
 *
 * [1]: https://github.com/dequelabs/axe-core-npm
 */

import React from "react";
import ReactDom from "react-dom";

if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
    void import("@axe-core/react").then(async ({default: axe}) => {
        await axe(React, ReactDom, 1000, {
            rules: [
                // We are building an app with web technology. Apps do not allow users to pinch
                // and zoom in.
                //
                // We can add font scaling options for vision impaired users.
                {
                    id: "meta-viewport",
                    enabled: false,
                },
            ],
        });
    });
}
