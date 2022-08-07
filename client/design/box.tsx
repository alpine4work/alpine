import {ReactNode, Ref, forwardRef} from "react";
import {Sprinkles, sprinkles} from "~/client/design/sprinkles.css";

const BoxForwardRef = forwardRef(Box);
export {BoxForwardRef as Box};

function Box({children, ...props}: Sprinkles & {children?: ReactNode}, ref: Ref<HTMLDivElement>) {
    return (
        <div ref={ref} className={sprinkles(props)}>
            {children}
        </div>
    );
}
