import "~/client/bootstrap/bootstrap";

import type {AppProps} from "next/app";
import Head from "next/head";
import {IconContext} from "phosphor-react";
import {ReactNode} from "react";
import {AppInitialRenderContextProvider} from "~/client/helpers/lifecycle/use-is-initial-app-render";
import {InitializeColorSchemeScript} from "~/client/design/color-scheme";
import {OverlayScopeContextProvider} from "~/client/design/overlay";
import {TooltipCoordinationContextProvider} from "~/client/design/tooltip";
import {spacing} from "~/shared/design/spacing";

export default function MyApp({Component, pageProps}: AppProps) {
    return (
        <>
            <Head>
                <InitializeColorSchemeScript />
            </Head>
            {decorators.reduce<ReactNode>(
                (children, decorator) => decorator(children),
                <Component {...pageProps} />,
            )}
        </>
    );
}

const decorators: Array<(children: ReactNode) => ReactNode> = [
    // Set some defaults for all the icons we're going to render.
    children => (
        <IconContext.Provider
            value={{
                color: "currentColor",
                size: spacing["5"],
            }}
        >
            {children}
        </IconContext.Provider>
    ),

    children => <AppInitialRenderContextProvider>{children}</AppInitialRenderContextProvider>,

    children => <OverlayScopeContextProvider>{children}</OverlayScopeContextProvider>,

    children => <TooltipCoordinationContextProvider>{children}</TooltipCoordinationContextProvider>,
];

// Reverse our decorators array so that the first decorator is the outermost
// wrapper of our element.
decorators.reverse();
