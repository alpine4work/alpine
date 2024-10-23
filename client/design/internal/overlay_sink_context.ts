import {createContext} from "react";
import {sprinkles} from "~/client/styles/styles.js";
import {RemLength} from "~/shared/design/core/spacing.js";

export type OverlaySinkContext = {
    readonly getRootPortalElement: () => HTMLDivElement | null;
    readonly getRootBlockingPortalElement: () => HTMLDivElement | null;
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

          document.body.appendChild(portalElement);
          document.body.appendChild(blockingPortalElement);

          const portalRef = {current: portalElement};
          const blockingPortalRef = {current: blockingPortalElement};

          return {
              getRootPortalElement: () => portalRef.current,
              getRootBlockingPortalElement: () => blockingPortalRef.current,
              getPortalElement: () => portalRef.current,
              insetLeft: null,
              insetRight: null,
          };
      })()
    : null;
