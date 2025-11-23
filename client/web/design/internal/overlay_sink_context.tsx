/* eslint-disable react-refresh/only-export-components */

import {Instance} from "@popperjs/core";
import {RefObject, createContext} from "react";
import {Box} from "~/client/web/design/box.js";
import {Sprinkles, sprinkles} from "~/client/web/styles/styles.js";
import {RemLength} from "~/shared/design/core/spacing.js";

export type OverlaySinkContext = {
    readonly getRootPortalElement: () => HTMLDivElement | null;
    readonly getBlockingPortalElement: () => HTMLDivElement | null;
    readonly getContextMenuBlockingPortalElement: () => HTMLDivElement | null;
    readonly getPortalElement: () => HTMLDivElement | null;
    readonly insetLeft: RemLength | number | null;
    readonly insetRight: RemLength | number | null;
};

export const OverlaySinkContext = createContext<OverlaySinkContext | null>(null);

// In Jest tests, create a portal element in the JSDOM `<body>`.
export const overlaySinkContextForTest = import.meta.jest
    ? ((): OverlaySinkContext => {
          const portalElement = document.createElement("div");

          portalElement.className = sprinkles({
              position: "absolute",
              top: "0",
              left: "0",
              right: "0",
              // The root portal element has a height of 0 because when you use it in a
              // nested scroll view we don't want the overlay height to extend from the top
              // to the bottom of the nested scroll view.
              height: "0",
              // Render above anything on the page.
              zIndex: "50",
          });

          const blockingPortalElement = document.createElement("div");

          blockingPortalElement.className = sprinkles({
              position: "absolute",
              top: "0",
              left: "0",
              right: "0",
              // The root portal element has a height of 0 because when you use it in a
              // nested scroll view we don't want the overlay height to extend from the top
              // to the bottom of the nested scroll view.
              height: "0",
              // Render above anything on the page.
              zIndex: "70",
          });

          const contextMenuBlockingPortalElement = document.createElement("div");

          contextMenuBlockingPortalElement.className = sprinkles({
              position: "absolute",
              top: "0",
              left: "0",
              right: "0",
              // The root portal element has a height of 0 because when you use it in a
              // nested scroll view we don't want the overlay height to extend from the top
              // to the bottom of the nested scroll view.
              height: "0",
              // Render above anything on the page.
              zIndex: "80",
          });

          document.body.appendChild(portalElement);
          document.body.appendChild(blockingPortalElement);
          document.body.appendChild(contextMenuBlockingPortalElement);

          const portalRef = {current: portalElement};
          const blockingPortalRef = {current: blockingPortalElement};
          const contextMenuBlockingPortalRef = {current: contextMenuBlockingPortalElement};

          return {
              getRootPortalElement: () => portalRef.current,
              getBlockingPortalElement: () => blockingPortalRef.current,
              getContextMenuBlockingPortalElement: () => contextMenuBlockingPortalRef.current,
              getPortalElement: () => portalRef.current,
              insetLeft: null,
              insetRight: null,
          };
      })()
    : null;

export function renderOverlayPortal(
    ref: RefObject<HTMLDivElement>,
    zIndex: Sprinkles["zIndex"] = "50",
) {
    return (
        <Box
            ref={ref}
            position="absolute"
            top="0"
            left="0"
            right="0"
            // The overlay portal element has a height of 0 because when you use it in a
            // nested scroll view we don't want the overlay height to extend from the top
            // to the bottom of the nested scroll view which is not the scroll view's
            // content height.
            height="0"
            // Render above anything on the page.
            zIndex={zIndex}
        />
    );
}

/**
 * Popper instances that are currently mounted by `<Overlay>`. Useful for
 * forcing all poppers to update their positions.
 */
export const overlayVisiblePoppers = new Set<Instance>();
