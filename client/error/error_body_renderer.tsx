import {Warning} from "phosphor-react";
import {Box} from "~/client/design/box";
import {ErrorDisplayMessageRenderer} from "~/client/error/error_display_message_renderer";
import {sprinkles, typographySize} from "~/shared/styles/styles";

/**
 * Renders an error with a title at body content size.
 */
export function ErrorBodyRenderer({title, error}: {title: string; error: unknown}) {
    return (
        <>
            <Box display="flex" gap="2" paddingBottom="2">
                <Box
                    flexShrink="0"
                    color="red-40"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    style={{
                        fontSize: typographySize.heading4.fontSize,
                        height: typographySize.heading4.lineHeight,
                    }}
                >
                    <Warning weight="fill" size={typographySize.heading4.fontSize} />
                </Box>
                <h1
                    className={sprinkles({
                        flexGrow: "1",
                        typographySize: "heading4",
                        typographyStyle: "primaryMedium",
                    })}
                >
                    {title}
                </h1>
            </Box>
            <ErrorDisplayMessageRenderer error={error} size="body" />
        </>
    );
}
