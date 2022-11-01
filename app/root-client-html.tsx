"use client";

import {ReactNode, useEffect, useState} from "react";
import {RootClientContextProvider} from "~/app/root-client-context-provider";
import {
    ColorScheme,
    getColorSchemeWithoutListening,
    listenToColorSchemeChanges,
} from "~/client/design/color-scheme/color-scheme";

/**
 * We can't know the color scheme on the server but we need to set the color
 * scheme to our HTML's `data-color-scheme` property before any UI renders so
 * CSS shows the correct colors.
 *
 * The way we do this is by making our `<html>` element a client component. On
 * the server it always renders with a `light` color scheme, but we inject a
 * synchronous script at the beginning of `<body>` that will update to the
 * right color scheme. Then when the client component hydrates, we have access
 * to `window` and when hydrating use the right color scheme.
 *
 * This is a little hacky but works well.
 */
const initializeColorSchemeScript =
    'var colorScheme = localStorage.getItem("colorScheme"); var isDarkColorScheme = colorScheme === "dark" || !colorScheme && window.matchMedia("(prefers-color-scheme: dark)").matches; document.documentElement.dataset.colorScheme = isDarkColorScheme ? "dark" : "light";';

export function RootClientHtml({
    bodyClassName,
    children,
}: {
    bodyClassName?: string;
    children: ReactNode;
}) {
    const [colorScheme, setColorScheme] = useState<ColorScheme>(
        getColorSchemeWithoutListening() ?? "light",
    );

    useEffect(() => {
        // Set the color scheme again in case there was a change between when we
        // mounted and when the effect starts.
        setColorScheme(getColorSchemeWithoutListening() ?? "light");

        return listenToColorSchemeChanges(setColorScheme);
    }, []);

    return (
        <html lang="en" data-color-scheme={colorScheme}>
            <head>{/* Will be filled in by `head.tsx` files in the `app` directory. */}</head>
            <body className={bodyClassName}>
                <script dangerouslySetInnerHTML={{__html: initializeColorSchemeScript}} />
                <RootClientContextProvider>{children}</RootClientContextProvider>
            </body>
        </html>
    );
}
