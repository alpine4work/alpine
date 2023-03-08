import {addSeconds} from "date-fns";
import {X} from "phosphor-react";
import {
    Memo,
    ReactNode,
    createContext,
    useCallback,
    useContext,
    useEffect,
    useLayoutEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
} from "react";
import {Box} from "~/client/design/box";
import {ErrorDisplayMessageRenderer} from "~/client/design/error_display_message_renderer";
import {ErrorIcon} from "~/client/design/error_icon";
import {IconButton} from "~/client/design/icon_button";
import {perceivedAsInstantLimitMs} from "~/client/design/timing_constants";
import {useDevConsoleTool} from "~/client/dev/dev_console";
import {spacing} from "~/shared/design/spacing";
import {InternalError, InvalidArgumentError} from "~/shared/error/error";
import {createTimeout} from "~/shared/helpers/async/timeout";
import {assertExists} from "~/shared/helpers/control/assert_exists";
import {cast} from "~/shared/helpers/control/cast";
import {exhaustive} from "~/shared/helpers/control/exhaustive";
import {clamp} from "~/shared/helpers/number/clamp";
import {toastStyles} from "~/shared/styles/styles";

// Error toasts should be visible long enough for the user to read but short
// enough so that the user can try again. Or if the user is already trying
// again we can show a queued error message.
//
// For accessibility it's recommended to have a [minimum time of 6
// seconds][1].
//
// [1]: https://sheribyrnehaber.medium.com/designing-toast-messages-for-accessibility-fb610ac364be
const defaultErrorToastDurationSeconds = 6;

/**
 * Toasts display brief, temporary notifications. They're meant to be noticed
 * but not disrupt a user's experience.
 */
export type Toast = ErrorToast;

/**
 * A toast displaying an error message. It lets the user know an error has
 * occurred but does not interrupt the user's experience.
 */
export type ErrorToast = {
    readonly type: "Error";

    /**
     * The "what happened" part of an error message according to [Adobe
     * Spectrum's][1] error content guidelines.
     *
     * Should not include ending punctuation. Ending punctuation will be
     * added for you.
     *
     * [1]: https://spectrum.adobe.com/page/writing-for-errors
     */
    readonly title: string;

    /**
     * The error we are rendering in an inline alert. We will render the
     * `ErrorDisplayMessage` from this error.
     */
    readonly error: unknown;
};

type ToastState = {
    readonly activeToast: {
        readonly toast: Toast;
        readonly startTime: Date;
        readonly durationSeconds: number;
        readonly isAnimatingOut: boolean;
    } | null;
    readonly toastQueue: ReadonlyArray<Toast>;
};

type ToastAction =
    | {
          readonly type: "ShowToast";
          readonly toast: Toast;
      }
    | {
          readonly type: "StartDismissActiveToastAnimation";
      }
    | {
          readonly type: "ActuallyDismissActiveToast";
      };

function reduce(state: ToastState, action: ToastAction): ToastState {
    switch (action.type) {
        case "ShowToast": {
            if (state.activeToast) {
                return {
                    activeToast: state.activeToast,
                    toastQueue: [...state.toastQueue, action.toast],
                };
            } else {
                return {
                    activeToast: {
                        toast: action.toast,
                        startTime: new Date(),
                        durationSeconds: defaultErrorToastDurationSeconds,
                        isAnimatingOut: false,
                    },
                    toastQueue: state.toastQueue,
                };
            }
        }
        case "StartDismissActiveToastAnimation": {
            if (!state.activeToast) return state;

            return {
                activeToast: {
                    ...state.activeToast,
                    isAnimatingOut: true,
                },
                toastQueue: state.toastQueue,
            };
        }
        case "ActuallyDismissActiveToast": {
            if (!state.activeToast) return state;

            if (state.toastQueue[0]) {
                return {
                    activeToast: {
                        toast: state.toastQueue[0],
                        startTime: new Date(),
                        durationSeconds: defaultErrorToastDurationSeconds,
                        isAnimatingOut: false,
                    },
                    toastQueue: state.toastQueue.slice(1),
                };
            }

            return {
                activeToast: null,
                toastQueue: [],
            };
        }
        default:
            throw exhaustive(action);
    }
}

const ToastContext = createContext<((toast: Toast) => void) | null>(null);

// TODO(calebmer): How does this work on mobile? We should maybe abstract this
// a bit so code is not saying "show toast" but rather "show alert" with some
// hinting on its importance.
export function ToastContextProvider({children}: {children?: ReactNode}) {
    const [state, dispatch] = useReducer(reduce, {activeToast: null, toastQueue: []});

    useEffect(() => {
        if (!state.activeToast || !state.activeToast.isAnimatingOut) return;

        const timeout = createTimeout(() => {
            dispatch({type: "ActuallyDismissActiveToast"});
        }, toastStyles.toastAnimateOutDuration + perceivedAsInstantLimitMs);

        return () => timeout.clear();
    }, [state.activeToast]);

    useDevConsoleTool("toast", () => ({
        showTestErrorToast: () =>
            dispatch({
                type: "ShowToast",
                toast: {
                    type: "Error",
                    title: "Test toast",
                    error: new InvalidArgumentError("Test toast"),
                },
            }),
    }));

    const dismiss = useCallback(({withoutAnimation = false}: {withoutAnimation?: boolean} = {}) => {
        if (withoutAnimation) {
            dispatch({type: "ActuallyDismissActiveToast"});
        } else {
            dispatch({type: "StartDismissActiveToastAnimation"});
        }
    }, []);

    return (
        <ToastContext.Provider
            value={useCallback((toast: Toast) => dispatch({type: "ShowToast", toast}), [])}
        >
            {children}
            <Box pointerEvents="none" position="absolute" inset="0" zIndex="60">
                {state.activeToast && (
                    <Box
                        key={state.activeToast.startTime.toISOString()}
                        position="absolute"
                        left="0"
                        bottom="0"
                        paddingLeft="4"
                        paddingBottom="4"
                        style={{
                            animation: state.activeToast.isAnimatingOut
                                ? toastStyles.toastAnimateOutAnimation
                                : toastStyles.toastAnimateInAnimation,
                        }}
                    >
                        <Box pointerEvents="auto">
                            <ToastView
                                toast={state.activeToast.toast}
                                startTime={state.activeToast.startTime}
                                durationSeconds={state.activeToast.durationSeconds}
                                onDismiss={dismiss}
                            />
                        </Box>
                    </Box>
                )}
            </Box>
        </ToastContext.Provider>
    );
}

/**
 * Return a function you can use to show toasts.
 */
export function useShowToast(): (toast: Toast) => void {
    const showToast = useContext(ToastContext);

    if (showToast === null)
        throw new InternalError("Must render in a `<ToastContextProvider>` to show toasts");

    return showToast;
}

function ToastView({
    toast,
    startTime,
    durationSeconds,
    onDismiss,
}: {
    toast: Toast;
    startTime: Date;
    durationSeconds: number;
    onDismiss: Memo<(options?: {withoutAnimation?: boolean}) => void>;
}) {
    const expirationTime = useMemo(
        () => addSeconds(startTime, durationSeconds),
        [durationSeconds, startTime],
    );

    useEffect(() => {
        const remainingDuration = expirationTime.getTime() - Date.now();
        if (remainingDuration <= 0) {
            onDismiss();
            return;
        }

        const timeout = createTimeout(onDismiss, remainingDuration);
        return () => timeout.clear();
    }, [expirationTime, onDismiss, startTime]);

    // Right now the only toast type we have is the error toast type. A couple
    // things we should change for other toast types:
    //
    // - Different expiration times
    // - No error icon (different icon or no icon)
    // - Don't use `role="alert"` and instead use `role="status"`
    cast<"Error">(toast.type);

    const [isInitialRender, setIsInitialRender] = useState(true);
    useLayoutEffect(() => {
        setIsInitialRender(false);
    }, []);

    return (
        <Box
            position="relative"
            maxWidth="128"
            backgroundColor={{light: "grey-0", dark: "grey-5"}}
            border={{light: "grey-0", dark: "grey-10"}}
            borderRadius="base"
            boxShadow="elevation-30"
            display="flex"
        >
            <Box flexGrow="1" alignSelf="center" display="flex" padding="2">
                <Box flexShrink="0" color="red-50-const" paddingRight="2">
                    <Box position="relative" style={{top: 1}}>
                        <ErrorIcon size={spacing["4"]} />
                    </Box>
                </Box>
                <Box flexGrow="1" role="alert">
                    {!isInitialRender && (
                        // [According to MDN][1], live regions (`role="alert"`, `role="status"`,
                        // `aria-live="assertive"`, `aria-live="polite"`) only notify users of assistive
                        // technology when the element updates. Not when it is added to the DOM. So we
                        // initially render without content then the element immediately re-renders with
                        // the alert content.
                        //
                        // [1]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/alert_role
                        <ErrorDisplayMessageRenderer
                            error={toast.error}
                            fontSize="75"
                            // Add punctuation to the title since it was written standalone.
                            prefixMessage={`${toast.title}.`}
                            isSingleLine={true}
                        />
                    )}
                </Box>
            </Box>
            <Box flexShrink="0" padding="1.5" paddingLeft="0">
                <IconButton
                    variant="quiet-on-grey-5-dark-background"
                    size="xs"
                    description="Dismiss alert"
                    withoutTooltip={true}
                    onPress={() => onDismiss({withoutAnimation: true})}
                >
                    <X />
                </IconButton>
                <ToastViewTimer startTime={startTime} expirationTime={expirationTime} />
            </Box>
        </Box>
    );
}

// Implementation of this timer is derived from:
// https://css-tricks.com/how-to-create-an-animated-countdown-timer-with-html-css-and-javascript
function ToastViewTimer({startTime, expirationTime}: {startTime: Date; expirationTime: Date}) {
    const countdownRef = useRef<SVGPathElement>(null);
    const dashes = Math.round(2 * Math.PI * 96);

    useEffect(() => {
        const countdownElement = assertExists(countdownRef.current);
        const currentTime = new Date();

        const startFraction = clamp(
            0,
            (currentTime.getTime() - startTime.getTime()) /
                (expirationTime.getTime() - startTime.getTime()),
            1,
        );

        const startDash = Math.round(startFraction * dashes);

        const animation = new Animation(
            new KeyframeEffect(
                countdownElement,
                [
                    {strokeDasharray: `${startDash} ${dashes}`},
                    {strokeDasharray: `${dashes} ${dashes}`},
                ],
                {
                    duration: expirationTime.getTime() - currentTime.getTime(),
                    fill: "both",
                    easing: "linear",
                    iterations: 1,
                },
            ),
        );

        animation.play();

        return () => {
            animation.cancel();
        };
    }, [dashes, expirationTime, startTime]);

    return (
        <Box position="relative" width="3" height="3" marginX="0.5">
            <Box position="absolute" inset="0" color={{light: "grey-10", dark: "grey-20"}}>
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width={spacing["3"]}
                    height={spacing["3"]}
                    fill="currentColor"
                    viewBox="0 0 256 256"
                >
                    <circle
                        cx="128"
                        cy="128"
                        r="96"
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="20"
                    />
                </svg>
            </Box>
            <Box position="absolute" inset="0" color="grey-70" style={{transform: "rotate(90deg)"}}>
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width={spacing["3"]}
                    height={spacing["3"]}
                    fill="currentColor"
                    viewBox="0 0 256 256"
                >
                    <path
                        ref={countdownRef}
                        d="
                            M 128, 128
                            m -96, 0
                            a 96,96 0 1,0 192,0
                            a 96,96 0 1,0 -192,0
                        "
                        fill="none"
                        stroke="currentColor"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth="20"
                        strokeDasharray={`0 ${dashes}`}
                        style={{transition: "100ms linear stroke-dasharray"}}
                    />
                </svg>
            </Box>
        </Box>
    );
}
