import {ReactNode} from "react";
import {Sprinkles, sprinkles} from "~/client/ui/sprinkles.css";

export function Box({children, ...props}: Sprinkles & {children?: ReactNode}) {
    return <div className={sprinkles(props)}>{children}</div>;
}
