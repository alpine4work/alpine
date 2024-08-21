import {animate} from "motion";
import {useEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {Box} from "~/client/design/box.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {setDevServerIsRestarting} from "~/client/remix/is_dev_server_restarting.js";
import {spacing, subtractRemLengths} from "~/shared/design/spacing.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {navigationBarStyles} from "~/shared/styles/styles.js";

/**
 * This is a fork of the [`<LiveReload>` component in `@remix-run/react`][1].
 *
 * We forked this component so we could render custom UI on live reload.
 *
 * After switching to Vite for our developer environment, `<LiveReload>` is no
 * longer required by Remix. However, we've re-branded the old "Remix dev
 * server" to the "Bazel dev server" which reports build status to the
 * developer. So we still use this component for Bazel build UI and Bazel full
 * page reloads.
 *
 * [1]: https://github.com/remix-run/remix/blob/d8f403490baef9b2814f7c2b984294bf08fc09df/packages/remix-react/components.tsx#L1777-L1886
 */
let AppLiveReload;

if (process.env.NODE_ENV !== "development") {
    AppLiveReload = function AppLiveReload() {
        return null;
    };
} else {
    AppLiveReload = function AppLiveReload({port, isMobile}: {port: number; isMobile: boolean}) {
        const messageRef = useRef<HTMLDivElement>(null);

        const [messageState, setMessageState] = useState<{
            message: string;
            expirationTime: number | null;
            animation: "In" | "Out" | null;
        } | null>(null);

        useEffect(() => {
            (window as any).__onBazelLiveReloadEvent = (
                event: {type: "LOG"; message: string} | {type: "RELOAD"},
            ) => {
                if (event.type === "LOG") {
                    const message = event.message.replace(/^\[bazel\] /, "");

                    setMessageState(previousMessageState => ({
                        message,
                        // If we see a message that starts with "Building" then we expect a "Built" (or
                        // "Failed to build") message next. So extend the expiration time so the
                        // developer is waiting for the "Built" message.
                        //
                        // If the message is "Built" (and not "Failed to build") expire the banner
                        // quickly since it might be from a hot reload. When there's a full reload we
                        // get `event.type === "RELOAD"` which removes the expiration time.
                        expirationTime:
                            Date.now() +
                            (message.startsWith("Building ")
                                ? 20_000
                                : message.startsWith("Built ")
                                ? 250
                                : 1_500),
                        animation: !previousMessageState ? "In" : null,
                    }));
                }

                // If we are reloading then keep the message around until the reload finishes.
                if (event.type === "RELOAD") {
                    // Disable certain error messages (like WebSocket lost connection) while
                    // we're reloading...
                    setDevServerIsRestarting();

                    setMessageState(previousMessageState => {
                        if (previousMessageState === null) return null;
                        return {...previousMessageState, expirationTime: null};
                    });
                }
            };

            return () => {
                delete (window as any).__onBazelLiveReloadMessageEvent;
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
                        easing: "ease-out",
                        // Make sure we use hardware acceleration for this animation in WebKit. By
                        // default `motion` turns it off.
                        // https://motion.dev/guides/performance#webkits-exceptions
                        allowWebkitAcceleration: true,
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
                        easing: "ease-in",
                        // Make sure we use hardware acceleration for this animation in WebKit. By
                        // default `motion` turns it off.
                        // https://motion.dev/guides/performance#webkits-exceptions
                        allowWebkitAcceleration: true,
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

        return (
            <>
                {messageState &&
                    createPortal(
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
                                // We don't want to import `navigation_bar.tsx` to avoid including that
                                // file in this bundle. Instead use `navigationBarStyles` since the CSS is
                                // available in every bundle.
                                style={{
                                    height: subtractRemLengths(
                                        spacing[
                                            navigationBarStyles[
                                                isMobile
                                                    ? "mobileNavigationBarHeight"
                                                    : "desktopNavigationBarHeight"
                                            ]
                                        ],
                                        spacing["4"],
                                    ),
                                }}
                            >
                                <Box fontStyle="truncate-code">{messageState.message}</Box>
                            </Box>
                        </Box>,
                        document.body,
                    )}
                <script
                    suppressHydrationWarning
                    dangerouslySetInnerHTML={{
                        __html: `\
function bazelLiveReloadConnect(config) {
    const protocol = location.protocol === "https:" ? "wss:" : "ws:";
    const host = location.hostname;
    const socketPath = protocol + "//" + host + ":${port}/socket";
    const ws = new WebSocket(socketPath);

    ws.onmessage = async message => {
        let event = JSON.parse(message.data);

        if (event.type === "LOG") {
            console.debug(event.message);
            window.__onBazelLiveReloadEvent?.(event);
        }

        if (event.type === "RELOAD") {
            console.debug("[bazel] Reloading window...");
            window.location.reload();
            window.__onBazelLiveReloadEvent?.(event);
        }
    };

    ws.onopen = () => {
        if (config && typeof config.onOpen === "function") {
            config.onOpen();
        }
    };

    ws.onclose = (event) => {
        if (event.code === 1006) {
            console.error(\`Bazel dev server WebSocket closed unexpectedly with code \${event.code}\${event.reason ? \`and reason "\${event.reason}"\` : ""}\${!event.wasClean ? " (did not close cleanly)" : ""}. Reconnecting...\`);
            setTimeout(() => {
                bazelLiveReloadConnect({
                    onOpen: () => window.location.reload(),
                });
            }, 1000);
        }
    };
}

bazelLiveReloadConnect();
`,
                    }}
                />
            </>
        );
    };
}

const AppLiveReloadConst = AppLiveReload;
export {AppLiveReloadConst as AppLiveReload};
