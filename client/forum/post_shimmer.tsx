import {Box} from "~/client/design/box";
import {postContentViewMinHeight} from "~/client/forum/post_content_view";
import {Spacing} from "~/shared/design/spacing";
import {fontSizes, pulseAnimationClassName} from "~/shared/styles/styles";

export function PostShimmer({
    padding,
    parentHasMargin,
}: {
    padding: Spacing;
    parentHasMargin: boolean;
}) {
    return (
        <Box
            backgroundColor="grey-0"
            borderRadius={parentHasMargin ? "md" : undefined}
            boxShadow="elevation-5"
            style={{height: postContentViewMinHeight}}
            display="flex"
            flexDirection="column"
        >
            <Box paddingX={padding} paddingTop={padding} display="flex" alignItems="center">
                <Box
                    className={pulseAnimationClassName}
                    flexShrink="0"
                    width="8"
                    height="8"
                    backgroundColor="grey-10"
                    borderRadius="full"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                />
                <Box paddingLeft="3">
                    <Box
                        style={{height: fontSizes["75"].lineHeight}}
                        display="flex"
                        alignItems="center"
                    >
                        <Box
                            className={pulseAnimationClassName}
                            width="32"
                            height="3"
                            backgroundColor="grey-5"
                            borderRadius="full"
                        />
                    </Box>
                    <Box
                        style={{height: fontSizes["50"].lineHeight}}
                        display="flex"
                        alignItems="center"
                    >
                        <Box
                            className={pulseAnimationClassName}
                            width="16"
                            height="2"
                            backgroundColor="grey-5"
                            borderRadius="full"
                        />
                    </Box>
                </Box>
            </Box>
            <Box flexGrow="1" />
            <Box
                marginX={padding}
                borderTop="grey-5"
                height="12"
                display="flex"
                alignItems="center"
            >
                <Box flexGrow="1" />
                <Box
                    className={pulseAnimationClassName}
                    width="24"
                    height="3"
                    backgroundColor="grey-5"
                    borderRadius="full"
                />
            </Box>
        </Box>
    );
}
