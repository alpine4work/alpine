import {useEffect, useLayoutEffect} from "react";

/**
 * Has the behavior of a `useLayoutEffect()` hook on the client, but we silence the
 * `useLayoutEffect()` warning when server-side rendering.
 *
 * Please use this hook sparingly! React warns when you use `useLayoutEffect()` on
 * the server for a reason. If your `useLayoutEffect()` changes the UI in some way
 * then it is not server-side rendering safe and you should rethink your approach.
 *
 * You may use this hook when one of the following is true:
 *
 * 1. Your `useLayoutEffect()` does not change the UI.
 * 2. You have taken special care to make sure the UI is correct after server-side
 *    rendering and before React mounts.
 *
 * When you use this hook please leave a comment explaining why it's safe.
 */
export const useLayoutEffectWithoutServerSideWarning =
    typeof window === "undefined" ? useEffect : useLayoutEffect;
