import {ReactNode} from "react";
import {Box} from "~/client/web/design/box.js";

/**
 * A small uppercase sidebar section label with a hairline underline, mirroring the
 * app's settings navigation ("My settings" / "Space settings").
 */
export function DocumentationSectionLabel({children}: {children: ReactNode}) {
    return (
        <Box
            fontSize="25"
            fontStyle="bold"
            color="grey-40"
            paddingBottom="2"
            paddingLeft="2.5"
            marginBottom="1.5"
            borderBottom="grey-5"
            style={{textTransform: "uppercase", letterSpacing: "0.05em"}}
        >
            {children}
        </Box>
    );
}
