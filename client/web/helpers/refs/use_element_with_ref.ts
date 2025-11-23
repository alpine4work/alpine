import {LegacyRef, ReactElement, Ref, cloneElement, useMemo} from "react";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {assert} from "~/shared/helpers/control/assert.js";

/**
 * Clones a React element and merges the provided ref with the element's
 * existing ref.
 *
 * Sometimes, when building a core component we want to enhance a child element
 * instead of adding a new element (e.g. `<div>` to the DOM). This can maximize
 * the flexibility of a core component by letting it seamlessly adapt to
 * whatever context it's in without the developer needing to think through the
 * implications of an extra element on their layout.
 *
 * When a core component wants to enhance a child element, there are a couple
 * options. Let's use `<Tooltip>` as an example:
 *
 * 1. Host the element yourself (e.g. render a `<div>` in `<Tooltip>`) and pass
 *    through all the `<div>` props down through `<Tooltip>`. It can be a little
 *    confusing that you need to add HTML props like `className` to `<Tooltip>`.
 *
 * 2. Use a render prop to pass down all the HTML props `<Tooltip>` needs. This
 *    makes the component interface more complicated as you force the developer
 *    to think about how the props are merged. There's also more room for
 *    mistake.
 *
 * 3. Use `cloneElement()` to pass down all the HTML props `<Tooltip>` needs.
 *    Doing this generally can be a bit error prone, you need to merge `ref`s,
 *    attributes, and event handlers correctly. This also depends on wrapper
 *    components like `<Button>` accepting all the HTML props needed by
 *    potential wrappers.
 *
 * 4. Use `useElementWithRef()` to get a ref to your child component, then use
 *    `useLayoutEffect()` to add your event handlers and attributes. This only
 *    requires you to correctly merge `ref`s and only requires child wrapper
 *    components to `forwardRef()` which provides an HTML instance. Refs provide
 *    strictly a superset of functionality to React props.
 *
 * We recommend approach 4 for core components as it provides the cleanest and
 * most flexible interface to developers.
 *
 * However, we do recommend using this "enhance child element" pattern
 * sparingly. If all code used this pattern we start to enter a more imperative
 * style instead of React's declarative style. We make this a core component
 * helper instead of a general helper because we hold core components to a high
 * quality standard. We trust that if you choose to use this pattern to
 * implement a core component, you'll provide a best in class declarative React
 * interface on top of it.
 */
export function useElementWithRef<T>(
    element: ReactElement & {ref?: LegacyRef<T>},
    ref: Ref<T>,
): ReactElement;
export function useElementWithRef<T>(
    element: (ReactElement & {ref?: LegacyRef<T>}) | undefined,
    ref: Ref<T>,
): ReactElement | undefined;
export function useElementWithRef<T>(
    element: (ReactElement & {ref?: LegacyRef<T>}) | undefined,
    ref: Ref<T>,
): ReactElement | undefined {
    const elementRef = element?.props?.ref ?? null;

    assert(typeof elementRef !== "string", "Legacy React string refs are not supported");

    const mergedRef = useMergedRefs(elementRef, ref);

    return useMemo(() => {
        if (!element) return undefined;
        return cloneElement(element, {ref: mergedRef});
    }, [element, mergedRef]);
}
