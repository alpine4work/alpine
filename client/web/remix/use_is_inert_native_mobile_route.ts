import {Router} from "@remix-run/router";
import {useContext} from "react";
import {UNSAFE_DataRouterContext as DataRouterContext} from "react-router";

/**
 * Is this an inert native mobile route? If so we should disable some effects. For
 * example disable scrolling in response to the keyboard frame changing.
 */
export function useIsInertNativeMobileRoute(): boolean {
    // Looks for the `_isInert` property on the router object which should be set in
    // `<NativeMobileOutlet>`.
    const router: (Router & {_isInert?: boolean}) | undefined =
        useContext(DataRouterContext)?.router;
    return router?._isInert ?? false;
}
