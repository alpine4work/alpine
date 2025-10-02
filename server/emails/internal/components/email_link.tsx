import {Link, LinkProps} from "@react-email/components";
import {ReactNode} from "react";
import {Color} from "~/shared/design/core/colors.js";

export function EmailLink({
    children,
    style,
    color,
    ...rest
}: {
    children?: ReactNode;
    style?: React.CSSProperties;
    color?: Color;
} & LinkProps) {
    return (
        <Link
            className={color ? `email-link ${color}` : "email-link"}
            style={{color: "inherit", ...style}}
            {...rest}
        >
            {children}
        </Link>
    );
}
