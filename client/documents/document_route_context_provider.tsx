import {RemixEntryContext} from "@remix-run/react";
import {ReactNode, createContext, useContext, useMemo, useRef} from "react";
import {useAppContext} from "~/client/context/app_context";
import type {DocumentRouteContext} from "~/client/documents/internal/types/document_route_context";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning";
import {assert} from "~/shared/helpers/control/assert";

const documentRouteId = "routes/s/$space_id/documents/$document_id/index";

const DocumentRouteContext = createContext<DocumentRouteContext | null>(null);

export function useDocumentRouteContext(): DocumentRouteContext | null {
    return useContext(DocumentRouteContext);
}

/**
 * We want to be able to reuse the same WebSocket connection between a
 * `<DocumentContentEditor>` and the comment thread peeks that open on top of
 * it. However the nearest common ancestor is the `/s/$space_id` layout route
 * since that's where peeks render! This context creates the document
 * collaboration WebSocket client at that level so both components can use it.
 *
 * It's carefully written to avoid bringing in any other document code into the
 * `/s/$space_id` bundle. Notably we export a `createDocumentRouteContext()`
 * function from the route module that actually creates the context when we
 * have the appropriate code loaded.
 */
export function DocumentRouteContextProvider({children}: {children?: ReactNode}) {
    const context = useAppContext();
    const contextRef = useRef(context);
    useLayoutEffectWithoutServerSideWarning(() => {
        contextRef.current = context;
    });

    const remixEntryContext = useContext(RemixEntryContext);
    assert(remixEntryContext, "Expected Remix entry context");

    const routeData = remixEntryContext.routeData[documentRouteId];
    const routeModule = remixEntryContext.routeModules[documentRouteId];

    return (
        <DocumentRouteContext.Provider
            value={useMemo(() => {
                if (!routeData || !routeModule) return null;
                return (routeModule.default as any).createDocumentRouteContext(
                    () => contextRef.current,
                    routeData,
                );
            }, [routeData, routeModule])}
        >
            {children}
        </DocumentRouteContext.Provider>
    );
}
