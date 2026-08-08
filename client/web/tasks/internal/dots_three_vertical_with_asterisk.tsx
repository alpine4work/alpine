import {DotsThreeVertical, IconContext} from "phosphor-react";
import {useContext} from "react";
import {Box} from "~/client/web/design/box.js";
import {parseRemLength, spacing} from "~/shared/design/core/spacing.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

export function DotsThreeVerticalWithAsterisk({withAsterisk}: {withAsterisk: boolean}) {
    const {size = spacing["4"]} = useContext(IconContext);
    assert(size === spacing["4"] || size === spacing["5"]);

    const position = `-${parseRemLength("0.5") / (size === spacing["5"] ? 4 : 2)}rem`;

    return (
        <Box position="relative" style={{width: size, height: size}}>
            <DotsThreeVertical size={size} />
            {withAsterisk && (
                <Box
                    position="absolute"
                    pointerEvents="none"
                    style={{top: position, right: position}}
                >
                    <Box
                        fontSize="75"
                        color="grey-50-translucent"
                        style={{
                            // Eye balled what appears to create the tightest box around the asterisk
                            // disregarding line height.
                            marginTop: "-0.14em",
                            marginBottom: "-0.55em",
                        }}
                    >
                        *
                    </Box>
                </Box>
            )}
        </Box>
    );
}
