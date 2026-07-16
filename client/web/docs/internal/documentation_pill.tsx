import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";
import {ColorSchemeVar} from "~/client/web/styles/styles.js";

/**
 * A small full-radius pill for statuses and badges ("required", "response
 * variant", schema kinds, …).
 */
export function DocumentationPill({
    color,
    backgroundColor,
    border,
    children,
}: {
    color: ColorSchemeVar;
    backgroundColor: ColorSchemeVar | "transparent";
    border?: ColorSchemeVar;
    children: ReactNode;
}) {
    return (
        <Box
            as="span"
            display="inline-flex"
            alignItems="center"
            gap="1"
            paddingX="2"
            paddingY="0.5"
            borderRadius="full"
            fontSize="50"
            fontStyle="semi-bold"
            color={color}
            backgroundColor={backgroundColor}
            border={border}
            style={{whiteSpace: "nowrap"}}
        >
            {children}
        </Box>
    );
}
