import {Box} from "~/client/design/box.js";
import {Button} from "~/client/design/button.js";
import {ColorSchemeToggleButton} from "~/client/design/playground/color_scheme_toggle_button.js";
import {DesignPlaygroundTooltipPage} from "~/client/design/playground/design_playground_tooltip_page.js";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title.js";
import {sprinkles} from "~/client/styles/styles.js";

export function meta() {
    return [{title: `Design Playground${metaTitlePostfix}`}];
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
                                    quiet-above:
                                </Box>
                                <Button variant="quiet-above-grey-5-dark-background">
                                    Quiet above button
                                </Button>
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
            </Box>
        </main>
    );
}
