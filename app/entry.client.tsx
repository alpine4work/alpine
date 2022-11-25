import {RemixBrowser} from "@remix-run/react";
import React from "react";
import ReactDom, {hydrateRoot} from "react-dom/client";
import {attachDeveloperConsole} from "~/client/helpers/developer_console";
import {ErrorSchema} from "~/shared/error/error_schema";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting";

// We've patched Remix so that when it serializes and deserializes errors it
// looks for this global and uses it.
(globalThis as any).__remixErrorSchema = ErrorSchema;

hydrateRoot(document, <RemixBrowser />);

attachDeveloperConsole();

// Initialize [axe][1] which is an automated accessibility tester.
// Accessibility violations are printed to the console.
//
// [1]: https://github.com/dequelabs/axe-core-npm
if (process.env.NODE_ENV === "development" && typeof window !== "undefined") {
    runPromiseWithoutAwaiting(async () => {
        const {default: axe} = await import("@axe-core/react");

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
