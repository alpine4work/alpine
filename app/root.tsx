import {Links, LiveReload, Meta, Outlet, Scripts, ScrollRestoration} from "@remix-run/react";
import {IconContext} from "phosphor-react";
import prosemirrorStylesHref from "prosemirror-view/style/prosemirror.css";
import {
    InitializeColorSchemeScript,
    getColorSchemeWithoutListening,
} from "~/client/design/color_scheme";
import {OverlayScopeContextProvider} from "~/client/design/overlay";
import {TooltipCoordinationContextProvider} from "~/client/design/tooltip";
import {AppInitialRenderContextProvider} from "~/client/helpers/lifecycle/use_is_initial_app_render";
import {spacing} from "~/shared/design/spacing";
import sharedStylesHref from "~/shared/styles/styles.css";

export function meta() {
    return {
        charset: "utf-8",
        title: "Cyberworlds",
        viewport: "width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no",
    };
}

export function links() {
    return [
        {rel: "stylesheet", href: sharedStylesHref},
        // ProseMirror includes some lightweight styling that's required for it to
        // work correctly.
        {rel: "stylesheet", href: prosemirrorStylesHref},
    ];
}

export default function Root() {
    const outlet = (
        <IconContext.Provider value={{color: "currentColor", size: spacing["5"]}}>
            <AppInitialRenderContextProvider>
                <OverlayScopeContextProvider>
                    <TooltipCoordinationContextProvider>
                        <Outlet />
                    </TooltipCoordinationContextProvider>
                </OverlayScopeContextProvider>
            </AppInitialRenderContextProvider>
        </IconContext.Provider>
    );

    return (
        <html lang="en" data-color-scheme={getColorSchemeWithoutListening()}>
            <head>
                <Meta />
                <Links />
                <InitializeColorSchemeScript />
            </head>
            <body>
                {outlet}
                <ScrollRestoration />
                <LiveReload />
                <Scripts />
            </body>
        </html>
    );
}
