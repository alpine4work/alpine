import {animate} from "motion";
import prettyMs from "pretty-ms";
import {useEffect, useRef, useState} from "react";
import {Box} from "~/client/web/design/box.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {navigationBarStyles} from "~/client/web/styles/styles.js";
import {Platform} from "~/shared/design/core/platform.js";
import {spacing, subtractRemLengths} from "~/shared/design/core/spacing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {BazelBuildEvent} from "~/shared/schema/helpers/bazel_build_event_schema.js";

let BazelBuildIndicator;

if (process.env.NODE_ENV !== "development") {
    BazelBuildIndicator = function BazelBuildIndicator() {
        return null;
    };
} else {
    BazelBuildIndicator = function BazelBuildIndicator({}: {platform: Platform}) {
        const messageRef = useRef<HTMLDivElement>(null);

        const [messageState, setMessageState] = useState<{
            message: string;
            expirationTime: number | null;
            animation: "In" | "Out" | null;
        } | null>(null);

        useEffect(() => {
            const handleBeforeFullReload = () => {
                setMessageState(previousMessageState => {
                    if (previousMessageState === null) return null;
                    return {...previousMessageState, expirationTime: null};
                });
            };

            const handleBazelBuild = (event: BazelBuildEvent) => {
                let message: string;
                switch (event.type) {
                    case "BuildStart": {
                        message = `Building ${event.targets.join(" ")}`;
                        break;
                    }
                    case "BuildFinish": {
                        if (event.hasFailed) {
                            message = `Failed to build ${event.targets.join(" ")} (${prettyMs(
                                event.durationMs,
                            )})`;
                        } else {
                            message = `Built ${event.targets.join(" ")} (${prettyMs(
                                event.durationMs,
                            )})`;
                        }
                        break;
                    }
                    default:
                        throw exhaustive(event);
                }

                // eslint-disable-next-line no-console
                console.debug(`[bazel] ${message}`);

                setMessageState(previousMessageState => ({
                    message,
                    // If the message is "Built" (and not "Failed to build") expire the banner quickly
                    // since it might be from a hot reload. When there's a full reload we get
                    // `event.type === "RELOAD"` which removes the expiration time.
                    expirationTime:
                        Date.now() +
                        (event.type === "BuildStart" ? 20_000 : !event.hasFailed ? 250 : 1_500),
                    animation: !previousMessageState ? "In" : null,
                }));
            };

            import.meta.hot?.on("vite:beforeFullReload", handleBeforeFullReload);
            import.meta.hot?.on("cyberworlds:bazel", handleBazelBuild);
            return () => {
                import.meta.hot?.off("vite:beforeFullReload", handleBeforeFullReload);
                import.meta.hot?.off("cyberworlds:bazel", handleBazelBuild);
            };
        }, []);

        useEffect(() => {
            if (!messageState) return;
            if (messageState.animation !== null) return;
            if (messageState.expirationTime === null) return;

            const timeout = createTimeout(() => {
                setMessageState({...messageState, animation: "Out"});
            }, messageState.expirationTime - Date.now());

            return () => timeout.clear();
        }, [messageState]);

        const lastMessageStateRef = useRef(messageState);
        useLayoutEffectWithoutServerSideWarning(() => {
            if (lastMessageStateRef.current === messageState) return;
            lastMessageStateRef.current = messageState;

            if (!messageState) return;
            const messageElement = assertExists(messageRef.current);

            if (messageState.animation === "In") {
                const animation = animate(
                    messageElement,
                    {opacity: [0, 1], y: [`-${spacing["10"]}`, 0]},
                    {
                        duration: 0.2,
                        ease: "easeOut",
                    },
                );

                void animation.finished.finally(() => {
                    setMessageState(previousMessageState => {
                        if (previousMessageState !== messageState) return previousMessageState;
                        return {...previousMessageState, animation: null};
                    });
                });
            }

            if (messageState.animation === "Out") {
                const animation = animate(
                    messageElement,
                    {opacity: [1, 0], y: [0, `-${spacing["10"]}`]},
                    {
                        duration: 0.2,
                        ease: "easeIn",
                    },
                );

                void animation.finished.finally(() => {
                    setMessageState(previousMessageState => {
                        if (previousMessageState !== messageState) return previousMessageState;
                        return null;
                    });
                });
            }
        }, [messageState]);

        if (!messageState) return null;

        return (
            <Box
                ref={messageRef}
                position="fixed"
                top="0"
                left="0"
                right="0"
                zIndex="80"
                overflow="hidden"
                backgroundColor={{light: "green-10", dark: "green-20"}}
                color="green-90"
                fontSize="50"
                boxShadow="elevation-30"
                paddingTop="safe-area-inset"
            >
                <Box
                    overflow="hidden"
                    paddingX="5"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    // We don't want to import `navigation_bar.tsx` to avoid including that file in
                    // this bundle. Instead use `navigationBarStyles` since the CSS is available in
                    // every bundle.
                    style={{
                        height: subtractRemLengths(navigationBarStyles.navigationBarHeight, "2"),
                    }}
                >
                    <Box fontStyle="truncate-code">{messageState.message}</Box>
                </Box>
            </Box>
        );
    };
}

const BazelBuildIndicatorConst = BazelBuildIndicator;
export {BazelBuildIndicatorConst as BazelBuildIndicator};
