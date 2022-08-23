import {CSSProperties, ReactNode, Ref, forwardRef} from "react";
import {Sprinkles, sprinkles} from "~/client/design/sprinkles.css";

const BoxForwardRef = forwardRef(Box);
export {BoxForwardRef as Box};

function Box(
    {
        children,
        className,
        style,
        ...props
    }: Sprinkles & {
        children?: ReactNode;
        className?: string;
        style?: CSSProperties;
    },
    ref: Ref<HTMLDivElement>,
) {
    return (
        <div
            ref={ref}
            className={className ? `${className} ${sprinkles(props)}` : sprinkles(props)}
            style={style}
        >
            {children}
        </div>
    );
}
