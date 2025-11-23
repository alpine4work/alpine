import {assignInlineVars} from "@vanilla-extract/dynamic";
import classNames from "classnames";
import {Sparkle} from "phosphor-react";
import {Box} from "~/client/web/design/box.js";
import {
    colorSchemeVars,
    contentStyles,
    inputPlaceholderStyles,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {
    listItemClassName,
    listItemIndentationVar,
    unorderedListItemClassName,
} from "~/shared/design/core/constant_class_names.js";
import {spacing} from "~/shared/design/core/spacing.js";

export function SearchInstructionalPlaceholder() {
    return (
        <Box
            fontSize="100"
            userSelect="text"
            color="grey-40"
            width="full"
            style={{fontWeight: inputPlaceholderStyles.fontWeight}}
        >
            <Box
                display="flex"
                alignItems="center"
                gap="2"
                paddingBottom={contentStyles.standaloneBlockMargin}
            >
                <Sparkle
                    size={spacing["4"]}
                    className={sprinkles({
                        // Optically center with text.
                        marginTop: "-0.5",
                    })}
                />
                <Box>Try advanced searches like…</Box>
            </Box>
            <Box className={contentStyles.docClassName} style={{color: colorSchemeVars["grey-40"]}}>
                {[
                    "my documents",
                    "messages from alex last week",
                    "tasks I updated yesterday",
                    "posts by jordan",
                ].map((example, i) => (
                    <Box
                        key={i}
                        className={classNames(listItemClassName, unorderedListItemClassName)}
                        style={{
                            ...assignInlineVars({
                                [listItemIndentationVar]: "0",
                            }),
                        }}
                        paddingBottom="1.5"
                    >
                        <Box paddingLeft="2">{example}</Box>
                    </Box>
                ))}
            </Box>
        </Box>
    );
}
