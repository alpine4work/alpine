import "~/client/bootstrap/bootstrap";

import {Fira_Code, Inter} from "@next/font/google";
import classNames from "classnames";
import type {AppProps} from "next/app";
import Head from "next/head";
import {IconContext} from "phosphor-react";
import {ReactNode} from "react";
import {InitializeColorSchemeScript} from "~/client/design/color-scheme";
import {OverlayScopeContextProvider} from "~/client/design/overlay";
import {sprinkles} from "~/client/design/sprinkles.css";
import {TooltipCoordinationContextProvider} from "~/client/design/tooltip";
import {AppInitialRenderContextProvider} from "~/client/helpers/lifecycle/use-is-initial-app-render";
import {spacing} from "~/shared/design/spacing";

// TODO(calebmer): Aggressively show error dialog if unhandled error occurs.
// Like Next.js in dev. Maybe it should be dismissable? Like Next.js.

const inter = Inter({weight: "variable", subsets: ["latin"], variable: "--inter"});
const firaCode = Fira_Code({weight: "variable", subsets: ["latin"], variable: "--fira-code"});

export default function App({Component, pageProps}: AppProps) {
    return (
        <div
            className={classNames(
                sprinkles({height: "full"}),
                inter.className,
                inter.variable,
                firaCode.variable,
            )}
        >
            <Head>
                <InitializeColorSchemeScript />
                <meta
                    name="viewport"
                    content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no"
                />
            </Head>
            {decorators.reduce<ReactNode>(
                (children, decorator) => decorator(children),
                <Component {...pageProps} />,
            )}
        </div>
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
