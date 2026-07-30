import {Box} from "~/client/web/design/box.js";
import {DocumentationUnstyledButton} from "~/client/web/docs/internal/documentation_unstyled_button.js";

/**
 * A pill-style segmented control. Used for guide tabs, the code sample language
 * switcher, and union variant selectors.
 */
export function DocumentationSegmentedControl({
    options,
    selectedIndex,
    onSelect,
    ariaLabel,
}: {
    options: Array<string>;
    selectedIndex: number;
    onSelect: (index: number) => void;
    ariaLabel: string;
}) {
    return (
        <Box
            display="inline-flex"
            backgroundColor="grey-1"
            border="grey-5"
            borderRadius="full"
            padding="0.5"
            role="tablist"
            aria-label={ariaLabel}
            alignSelf="flex-start"
        >
            {options.map((option, index) => {
                const selected = index === selectedIndex;
                return (
                    <DocumentationUnstyledButton
                        key={option}
                        role="tab"
                        ariaSelected={selected}
                        onClick={() => onSelect(index)}
                        box={{
                            border: "none",
                            cursor: "pointer",
                            borderRadius: "full",
                            paddingX: "3",
                            paddingY: "1",
                            fontSize: "50",
                            fontStyle: selected ? "semi-bold" : "normal",
                            backgroundColor: selected ? "grey-0" : "transparent",
                            color: selected ? "grey-90" : "grey-50",
                            boxShadow: selected ? "elevation-5" : undefined,
                        }}
                    >
                        {option}
                    </DocumentationUnstyledButton>
                );
            })}
        </Box>
    );
}
