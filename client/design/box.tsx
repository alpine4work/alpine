import {CSSProperties, ReactNode, Ref, forwardRef} from "react";
import {Sprinkles, sprinkles} from "~/client/design/sprinkles.css";

const BoxForwardRef = forwardRef(Box);
export {BoxForwardRef as Box};

function Box(
    {
        children,
        style,
        ...props
    }: Sprinkles & {
        children?: ReactNode;
        style?: CSSProperties;
    },
    ref: Ref<HTMLDivElement>,
) {
    return (
        <div ref={ref} className={sprinkles(props)} style={style}>
            {children}
        </div>
    );
}
