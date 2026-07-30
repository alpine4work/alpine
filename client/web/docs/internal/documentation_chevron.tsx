import {CaretRight} from "phosphor-react";
import {Box} from "~/client/web/design/box.js";

/**
 * A small caret that rotates when its disclosure is open. Used by expandable doc
 * rows and sidebar groups.
 */
export function DocumentationChevron({open}: {open: boolean}) {
    return (
        <Box
            as="span"
            display="inline-flex"
            alignItems="center"
            justifyContent="center"
            color="grey-40"
            style={{
                transition: "transform 0.15s ease",
                transform: open ? "rotate(90deg)" : "none",
                flex: "0 0 auto",
            }}
        >
            <CaretRight size={12} weight="bold" />
        </Box>
    );
}
