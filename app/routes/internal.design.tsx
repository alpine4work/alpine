import {ArrowClockwise} from "phosphor-react";
import {useMemo, useState} from "react";
import {BlobsArt} from "~/client/web/blobs/blobs_art.js";
import {Box} from "~/client/web/design/box.js";
import {Button} from "~/client/web/design/button.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {ColorSchemeToggleButton} from "~/client/web/design/playground/color_scheme_toggle_button.js";
import {DesignPlaygroundTooltipPage} from "~/client/web/design/playground/design_playground_tooltip_page.js";
import {TextInput} from "~/client/web/design/text_input.js";
import {useInitialAppRenderId} from "~/client/web/helpers/lifecycle/initial_app_render.js";
import {metaTitlePostfix} from "~/client/web/remix/use_update_meta_title.js";
import {sprinkles} from "~/client/web/styles/styles.js";
import {ThemeColor, themeColors} from "~/shared/design/core/theme_colors.js";
import {generateId} from "~/shared/id/id.js";

export function meta() {
    return [{title: `Design Playground${metaTitlePostfix}`}];
}

function BlobsPlayground() {
    const initialSeed = useInitialAppRenderId();
    const [seed, setSeed] = useState<string>(initialSeed ?? generateId());
    const [hueSpread, setHueSpread] = useState<number>(15);
    const [themeColor, setThemeColor] = useState<ThemeColor>("blue");
    const settings = useMemo(
        () => ({
            seed,
            themeColor,
            hueSpread,
        }),
        [seed, themeColor, hueSpread],
    );

    return (
        <Box>
            <h2>Blobs Playground</h2>
            <Box style={{flexBasis: 400}} display="flex" flexDirection="row" gap="4" marginY="4">
                <Box display="flex" gap="4" alignItems="center" justifyContent="flex-start">
                    <TextInput label="Seed" value={seed} onChange={setSeed} />
                    <IconButton description="Randomize seed" onPress={() => setSeed(generateId())}>
                        <ArrowClockwise />
                    </IconButton>
                </Box>
                <Box
                    display="flex"
                    flexDirection="column"
                    alignItems="center"
                    justifyContent="flex-start"
                >
                    <Box width="24">Theme</Box>
                    <select
                        value={themeColor}
                        onChange={e => setThemeColor(e.target.value as ThemeColor)}
                        className={sprinkles({
                            paddingX: "3",
                            paddingY: "2",
                            borderRadius: "1",
                        })}
                    >
                        {themeColors.map(color => (
                            <option key={color} value={color}>
                                {color}
                            </option>
                        ))}
                    </select>
                </Box>
                <Box display="flex" gap="4" alignItems="center" justifyContent="flex-start">
                    <TextInput
                        label="Hue spread"
                        value={hueSpread.toString()}
                        onChange={value => setHueSpread(Number(value))}
                    />
                </Box>
            </Box>
            <Box
                style={{
                    aspectRatio: `2 / 1`,
                    transformOrigin: "top left",
                    transform: `scale(0.5)`,
                }}
                boxShadow="elevation-10"
                borderRadius="1"
                overflow="hidden"
                position="relative"
                flex="auto"
            >
                <BlobsArt settings={settings} />
            </Box>
        </Box>
    );
}

export default function DesignPlaygroundRoute() {
    return (
        <main className={sprinkles({backgroundColor: "grey-0"})}>
            <Box padding="4">
                <ColorSchemeToggleButton />
                <h1>Design Playground</h1>
                <Box width="12" height="12" backgroundColor={{dark: "grey-20"}} />
                <Box width="12" height="12" backgroundColor="grey-10" />
                <DesignPlaygroundTooltipPage />
                <Box
                    marginY="8"
                    padding="16"
                    display="flex"
                    justifyContent="center"
                    gap="12"
                    borderRadius="1"
                    backgroundColor="grey-5"
                >
                    <Box
                        backgroundColor="grey-0"
                        width="32"
                        height="32"
                        borderRadius="1"
                        boxShadow="elevation-5"
                    />
                    <Box
                        backgroundColor="grey-0"
                        width="32"
                        height="32"
                        borderRadius="1"
                        boxShadow="elevation-10"
                    />
                    <Box
                        backgroundColor="grey-0"
                        width="32"
                        height="32"
                        borderRadius="1"
                        boxShadow="elevation-20"
                    />
                    <Box
                        backgroundColor="grey-0"
                        width="32"
                        height="32"
                        borderRadius="1"
                        boxShadow="elevation-30"
                    />
                    <Box
                        backgroundColor="grey-0"
                        width="32"
                        height="32"
                        borderRadius="1"
                        boxShadow="elevation-40"
                    />
                    <Box
                        backgroundColor="grey-0"
                        width="32"
                        height="32"
                        borderRadius="1"
                        boxShadow="elevation-50"
                    />
                    <Box
                        backgroundColor="grey-0"
                        width="32"
                        height="32"
                        borderRadius="1"
                        boxShadow="elevation-60"
                    />
                </Box>

                <Box>
                    <h2>Button Variants</h2>
                    <Box marginY="8" borderRadius="1" backgroundColor="grey-0">
                        <Box display="flex" flexDirection="column" gap="4">
                            <Box display="flex" alignItems="center" gap="4">
                                <Box width="24" textAlign="right">
                                    quiet:
                                </Box>
                                <Button variant="quiet">Quiet button</Button>
                            </Box>
                            <Box display="flex" alignItems="center" gap="4">
                                <Box width="24" textAlign="right">
                                    quieter:
                                </Box>
                                <Button variant="quieter">Quieter button</Button>
                            </Box>
                            <Box display="flex" alignItems="center" gap="4">
                                <Box width="24" textAlign="right">
                                    quietest:
                                </Box>
                                <Button variant="quietest">Quietest button</Button>
                            </Box>
                            <Box display="flex" alignItems="center" gap="4">
                                <Box width="24" textAlign="right">
                                    quiet-on:
                                </Box>
                                <Button variant="quiet-on">Quiet on button</Button>
                            </Box>
                            <Box display="flex" alignItems="center" gap="4">
                                <Box width="24" textAlign="right">
                                    quiet-off:
                                </Box>
                                <Button variant="quiet-off">Quiet off button</Button>
                            </Box>
                            <Box display="flex" alignItems="center" gap="4">
                                <Box width="24" textAlign="right">
                                    neutral:
                                </Box>
                                <Button variant="neutral">Neutral button</Button>
                            </Box>
                            <Box display="flex" alignItems="center" gap="4">
                                <Box width="24" textAlign="right">
                                    neutral-disabled:
                                </Box>
                                <Button variant="neutral-disabled">Neutral disabled button</Button>
                            </Box>
                            <Box display="flex" alignItems="center" gap="4">
                                <Box width="24" textAlign="right">
                                    accent:
                                </Box>
                                <Button variant="accent">Accent button</Button>
                            </Box>
                            <Box display="flex" alignItems="center" gap="4">
                                <Box width="24" textAlign="right">
                                    accent-disabled:
                                </Box>
                                <Button variant="accent-even-when-disabled" isDisabled>
                                    Accent when disabled
                                </Button>
                            </Box>
                            <Box display="flex" alignItems="center" gap="4">
                                <Box width="24" textAlign="right">
                                    outline:
                                </Box>
                                <Button variant="outline">Outline button</Button>
                            </Box>
                        </Box>
                    </Box>
                </Box>
                <BlobsPlayground />
            </Box>
        </main>
    );
}
