import {DetailedHTMLProps, HTMLAttributes, Ref, createElement, forwardRef} from "react";
import {Sprinkles, sprinkles} from "~/shared/styles/styles.js";

const BoxForwardRef = forwardRef(Box);
export {BoxForwardRef as Box};

function Box(
    props: Sprinkles & Omit<HTMLAttributes<HTMLDivElement>, keyof Sprinkles>,
    ref: Ref<HTMLDivElement>,
) {
    const sprinklesProps: Sprinkles = {};
    const divProps: DetailedHTMLProps<HTMLAttributes<HTMLDivElement>, HTMLDivElement> = {};

    for (const [key, value] of Object.entries(props)) {
        if (sprinkles.properties.has(key as any)) {
            (sprinklesProps as any)[key] = value;
        } else {
            (divProps as any)[key] = value;
        }
    }

    const sprinklesClassName = sprinkles(sprinklesProps);

    divProps.ref = ref;

    divProps.className = divProps.className
        ? `${divProps.className} ${sprinklesClassName}`
        : sprinklesClassName;

    return createElement("div", divProps);
}
