import {Warning} from "phosphor-react";
import {Box} from "~/client/design/box";
import {ErrorDisplayMessageRenderer} from "~/client/error/error_display_message_renderer";
import {fontSizes, sprinkles} from "~/shared/styles/styles";

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
                        fontSize: fontSizes["400"].fontSize,
                        height: fontSizes["400"].lineHeight,
                    }}
                >
                    <Warning weight="fill" size={fontSizes["400"].fontSize} />
                </Box>
                <h1
                    className={sprinkles({
                        flexGrow: "1",
                        fontSize: "400",
                        fontStyle: "semi-bold",
                    })}
                >
                    {title}
                </h1>
            </Box>
            <ErrorDisplayMessageRenderer error={error} fontSize="200" />
        </>
    );
}
