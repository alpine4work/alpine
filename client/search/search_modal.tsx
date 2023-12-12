import {MagnifyingGlass} from "phosphor-react";
import {useEffect, useRef} from "react";
import {Box} from "~/client/design/box.js";
import {Modal} from "~/client/design/modal.js";
import {useSpaceContext} from "~/client/spaces/space_context.js";
import {Spacing, parseRemLengthNumber, spacing} from "~/shared/design/spacing.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {sprinkles} from "~/shared/styles/styles.js";

// NOCOMMIT: Double check that this renders on top of peeks. Add a test

export function SearchModal() {
    return (
        <Modal
            aria-label="Search"
            maxWidth="256"
            height="full"
            maxHeight="192"
            borderRadius="lg"
            withoutCloseButton={true}
            onClose={() => {
                // NOCOMMIT
            }}
        >
            <Box width="full" height="full" display="flex" flexDirection="column">
                <SearchModalInput />
            </Box>
        </Modal>
    );
}

function SearchModalInput() {
    const {space} = useSpaceContext();
    const inputRef = useRef<HTMLInputElement>(null);

    // Immediately focus the search input.
    const hasInitiallyMountedRef = useRef(false);
    useEffect(() => {
        if (hasInitiallyMountedRef.current) return;
        hasInitiallyMountedRef.current = true;

        assertExists(inputRef.current).focus();
    }, []);

    const height: Spacing = "12";
    const paddingLeft: Spacing = "10";
    const iconSize: Spacing = "4";

    const heightRem = parseRemLengthNumber(spacing[height]);
    const paddingLeftRem = parseRemLengthNumber(spacing[paddingLeft]);
    const iconSizeRem = parseRemLengthNumber(spacing[iconSize]);

    return (
        <Box flexShrink="0" position="relative" width="full" borderBottom="grey-10">
            <MagnifyingGlass
                size={`${iconSizeRem}rem`}
                className={sprinkles({
                    pointerEvents: "none",
                    position: "absolute",
                    color: "grey-40",
                })}
                style={{
                    top: `${(heightRem - iconSizeRem) / 2}rem`,
                    left: `${(paddingLeftRem - iconSizeRem) / 2}rem`,
                }}
            />
            <input
                ref={inputRef}
                className={sprinkles({
                    display: "block",
                    width: "full",
                    height,
                    paddingLeft,
                    paddingRight: "1",
                    fontSize: "400",
                    backgroundColor: "transparent",
                })}
                placeholder={`Search ${space.name}…`}
            />
        </Box>
    );
}
