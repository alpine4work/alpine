import {DetailedHTMLProps, HTMLAttributes, Ref, createElement, forwardRef} from "react";
import {Sprinkles, sprinkles} from "~/client/styles/styles.js";

export type BoxProps = Sprinkles &
    Omit<HTMLAttributes<HTMLElement>, keyof Sprinkles> & {
        /**
         * The HTML element to render as. Defaults to 'div'.
         */
        as?: keyof JSX.IntrinsicElements;
    };

const BoxForwardRef = forwardRef(Box);
export {BoxForwardRef as Box};

// TODO(calebmer, #swc-transform): Someday, we should build a SWC compiler
// plugin that inlines this component into `<div>`s and pre-computes the
// `sprinkles()` function call. The only time we shouldn't inline this
// component is if there's a spread in the props we can't statically analyze.
function Box(props: BoxProps, ref: Ref<HTMLElement>) {
    const sprinklesProps: Sprinkles = {};
    const elementProps: DetailedHTMLProps<HTMLAttributes<HTMLElement>, HTMLElement> = {};
    let as: keyof JSX.IntrinsicElements = "div";

    for (const [key, value] of Object.entries(props)) {
        if (key === "as") {
            // Check if we are using the `Box` component as any other HTMLElement
            // and extract that value.
            as = value;
        } else if (sprinkles.properties.has(key as any)) {
            (sprinklesProps as any)[key] = value;
        } else {
            (elementProps as any)[key] = value;
        }
    }

    const sprinklesClassName = sprinkles(sprinklesProps);

    elementProps.ref = ref;

    elementProps.className = elementProps.className
        ? `${elementProps.className} ${sprinklesClassName}`
        : sprinklesClassName;

    return createElement(as, elementProps);
}
