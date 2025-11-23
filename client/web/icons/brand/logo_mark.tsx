import {memo} from "react";
import {colorSchemeVars} from "~/client/web/styles/styles.js";
import {Color} from "~/shared/design/core/colors.js";
import {Spacing, spacing} from "~/shared/design/core/spacing.js";

const LogoMarkMemo = memo(LogoMark);
export {LogoMarkMemo as LogoMark};

function LogoMark({size, color}: {size?: Spacing; color?: Color | `#${string}`}) {
    const finalColor = color?.startsWith("#")
        ? color
        : colorSchemeVars[(color as Color | undefined) ?? "grey-90"];

    const actualSize = size ? spacing[size] : spacing["32"];
    const svgSize = parseFloat(actualSize);

    return (
        <svg
            xmlns="http://www.w3.org/2000/svg"
            style={{width: `${svgSize}rem`, height: `${svgSize}rem`}}
            fill={finalColor}
            viewBox="0 0 198.4551 198.4551"
        >
            <path
                d="M99.6291,16.6566c2.798-6.8092,9.093-10.2107,15.39-10.2143h.01c6.296.0036,12.601,3.4051,15.39,10.2143l68.06,165.8176h-53.831c-.313.006-.626.01-.94.01-.315,0-.628-.004-.941-.01H31.5787L99.6291,16.6566ZM128.8461,73.037c0,13.2467-6.401,25.0235-16.328,32.5043-8.72,8.1249-14.1581,19.6189-14.1581,32.3619,0,9.08,2.7611,17.526,7.5041,24.571h-44.4588l50.2908-122.5449c10.462,7.4903,17.15,20.1661,17.15,33.1077Z"
                style={{fillRule: "evenodd"}}
            />
            <path d="M21.6421,182.4703l46.7078-113.8125c.3915-.9539.3949-2.0229.0096-2.9792h0c-1.9279-4.7966-6.2869-7.1926-10.6402-7.1952h-.0069c-4.3534.0026-8.7055,2.3986-10.6403,7.1952L.024,182.4703l21.637.0027-.0189-.0027Z" />
        </svg>
    );
}
