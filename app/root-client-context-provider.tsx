"use client";

import {IconContext} from "phosphor-react";
import React, {ReactNode} from "react";
import {OverlayScopeContextProvider} from "~/client/design/overlay";
import {TooltipCoordinationContextProvider} from "~/client/design/tooltip";
import {AppInitialRenderContextProvider} from "~/client/helpers/lifecycle/use-is-initial-app-render";
import {spacing} from "~/shared/design/spacing";

export function RootClientContextProvider({children}: {children: ReactNode}) {
    return <>{providers.reduce<ReactNode>((children, provider) => provider(children), children)}</>;
}

const providers: Array<(children: ReactNode) => ReactNode> = [
    // Set some defaults for all the icons we're going to render.
    //
    // TODO(calebmer): How are we going to render icons on the server given we
    // don't have context on the server?
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
providers.reverse();
