import {addSeconds} from "date-fns/addSeconds";
import {X} from "phosphor-react";
import {
    Memo,
    ReactNode,
    useCallback,
    useEffect,
    useLayoutEffect,
    useMemo,
    useReducer,
    useRef,
    useState,
} from "react";
import {AppContext} from "~/client/web/context/app_context.js";
import {Box} from "~/client/web/design/box.js";
import {ErrorDisplayMessageRenderer} from "~/client/web/design/error_display_message_renderer.js";
import {ErrorIcon} from "~/client/web/design/error_icon.js";
import {IconButton} from "~/client/web/design/icon_button.js";
import {
    Reporter,
    ReporterContext,
    ReporterModalDialogProps,
    ReporterWithoutContext,
} from "~/client/web/design/internal/reporter_context.js";
import {ModalDialog} from "~/client/web/design/modal_dialog.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {toastStyles} from "~/client/web/styles/styles.js";
import {greyElevated2ClassName} from "~/shared/design/core/constant_class_names.js";
import {Platform} from "~/shared/design/core/platform.js";
import {spacing} from "~/shared/design/core/spacing.js";
import {perceivedAsInstantLimitMs} from "~/shared/design/core/timing.js";
import {ErrorBase} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {scheduleUncaughtError} from "~/shared/helpers/async/schedule_uncaught_error.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {DefaultWeakMap} from "~/shared/helpers/map/default_weak_map.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

/**
 * Error toasts should be visible long enough for the user to read but short
 * enough so that the user can try again. Or if the user is already trying
 * again we can show a queued error message.
 *
 * For accessibility it's recommended to have a [minimum time of 6
 * seconds][1].
 *
 * [1]: https://sheribyrnehaber.medium.com/designing-toast-messages-for-accessibility-fb610ac364be
 */
const defaultToastDurationSeconds = 6;

/**
 * Toasts display brief, temporary notifications. They're meant to be noticed
 * but not disrupt a user's experience.
 */
type Toast = InfoToast | ErrorToast;

/**
 * A toast displaying some quick, transient, information to the user.
 */
type InfoToast = {
    readonly type: "Info";
    readonly message: ReactNode;
    readonly durationSeconds?: number;
};

/**
 * A toast displaying an error message. It lets the user know an error has
 * occurred but does not interrupt the user's experience.
 */
type ErrorToast = {
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

    /**
     * The context where the error was reported. We want to use the
     * tracer from this context when logging the error.
     */
    readonly reportingContext: AppContext;

    readonly durationSeconds?: undefined;
};

let nextReporterModalDialogId = 1;

type ReporterState = {
    readonly activeDialog: {
        readonly id: number;
        readonly props: ReporterModalDialogProps;
    } | null;
    readonly dialogQueue: ReadonlyArray<{
        readonly id: number;
        readonly props: ReporterModalDialogProps;
    }>;
} & (
    | {
          readonly platform: "mobile";
          readonly activeToast?: undefined;
      }
    | {
          readonly platform: "desktop";
          readonly activeToast: {
              readonly toast: Toast;
              readonly startTime: Date;
              readonly isAnimatingOut: boolean;
          } | null;
          readonly toastQueue: ReadonlyArray<Toast>;
      }
);

const desktopInitialReporterState: ReporterState = {
    platform: "desktop",
    activeDialog: null,
    dialogQueue: [],
    activeToast: null,
    toastQueue: [],
};

const mobileInitialReporterState: ReporterState = {
    platform: "mobile",
    activeDialog: null,
    dialogQueue: [],
};

type ReporterAction =
    | {
          readonly type: "SetPlatform";
          readonly platform: Platform;
      }
    | {
          readonly type: "DisplayError";
          readonly time: Date;
          readonly title: string;
          readonly error: unknown;
          readonly reportingContext: AppContext;
      }
    | {
          readonly type: "ShowDialog";
          readonly dialogProps: ReporterModalDialogProps;
      }
    | {
          readonly type: "CloseActiveDialog";
      }
    | {
          readonly type: "ShowToast";
          readonly time: Date;
          readonly toast: Toast;
      }
    | {
          readonly type: "StartDismissActiveToastAnimation";
      }
    | {
          readonly type: "ActuallyDismissActiveToast";
      };

function reduceReporterState(state: ReporterState, action: ReporterAction): ReporterState {
    switch (action.type) {
        case "SetPlatform": {
            if (state.platform === action.platform) return state;

            // Switching to mobile immediately throws away all pending toasts.
            if (action.platform === "mobile") {
                return {
                    platform: action.platform,
                    activeDialog: state.activeDialog,
                    dialogQueue: state.dialogQueue,
                };
            } else {
                return {
                    platform: action.platform,
                    activeDialog: state.activeDialog,
                    dialogQueue: state.dialogQueue,
                    activeToast: null,
                    toastQueue: [],
                };
            }
        }
        case "DisplayError": {
            if (state.platform === "mobile") {
                // NOTE(calebmer): The dialog doesn't show an error icon. That's because we
                // don't have much ability to customize the native iOS dialog we render.
                return reduceReporterState(state, {
                    type: "ShowDialog",
                    dialogProps: {
                        title: action.title,
                        description: {
                            type: "Error",
                            error: action.error,
                            reportingContext: action.reportingContext,
                        },
                        primaryButtonLabel: "Ok",
                        shouldHideCancelButton: true,
                    },
                });
            } else {
                return reduceReporterState(state, {
                    type: "ShowToast",
                    time: action.time,
                    toast: {
                        type: "Error",
                        title: action.title,
                        error: action.error,
                        reportingContext: action.reportingContext,
                    },
                });
            }
        }
        case "ShowDialog": {
            const id = nextReporterModalDialogId;
            nextReporterModalDialogId += 1;

            if (state.activeDialog) {
                return {
                    ...state,
                    dialogQueue: [...state.dialogQueue, {id, props: action.dialogProps}],
                };
            } else {
                return {
                    ...state,
                    activeDialog: {id, props: action.dialogProps},
                };
            }
        }
        case "CloseActiveDialog": {
            if (!state.activeDialog) return state;

            if (state.dialogQueue[0]) {
                return {
                    ...state,
                    activeDialog: state.dialogQueue[0],
                    dialogQueue: state.dialogQueue.slice(1),
                };
            } else {
                return {
                    ...state,
                    activeDialog: null,
                };
            }
        }
        case "ShowToast": {
            if (state.platform === "mobile") return state;

            if (state.activeToast) {
                return {
                    ...state,
                    toastQueue: [...state.toastQueue, action.toast],
                };
            } else {
                return {
                    ...state,
                    activeToast: {
                        toast: action.toast,
                        startTime: action.time,
                        isAnimatingOut: false,
                    },
                };
            }
        }
        case "StartDismissActiveToastAnimation": {
            if (state.platform === "mobile") return state;
            if (!state.activeToast) return state;

            return {
                ...state,
                activeToast: {
                    ...state.activeToast,
                    isAnimatingOut: true,
                },
                toastQueue: state.toastQueue,
            };
        }
        case "ActuallyDismissActiveToast": {
            if (state.platform === "mobile") return state;
            if (!state.activeToast) return state;

            if (state.toastQueue[0]) {
                return {
                    ...state,
                    activeToast: {
                        toast: state.toastQueue[0],
                        startTime: new Date(),
                        isAnimatingOut: false,
                    },
                    toastQueue: state.toastQueue.slice(1),
                };
            }

            return {
                ...state,
                activeToast: null,
            };
        }
        default:
            throw exhaustive(action);
    }
}

export function ReporterContextProvider({children}: {children?: ReactNode}) {
    const platform = usePlatform();

    const [actualState, dispatch] = useReducer(
        reduceReporterState,
        platform === "mobile" ? mobileInitialReporterState : desktopInitialReporterState,
    );
    let state = actualState;

    if (actualState.platform !== platform) {
        const action: ReporterAction = {type: "SetPlatform", platform};
        dispatch(action);
        state = reduceReporterState(state, action);
    }

    const stateRef = useRef(state);
    useLayoutEffectWithoutServerSideWarning(() => {
        stateRef.current = state;
    });

    useEffect(() => {
        if (state.platform === "mobile" || !state.activeToast || !state.activeToast.isAnimatingOut)
            return;

        const timeout = createTimeout(() => {
            dispatch({type: "ActuallyDismissActiveToast"});
        }, toastStyles.toastAnimateOutDuration + perceivedAsInstantLimitMs);

        return () => timeout.clear();
    }, [state.activeToast, state.platform]);

    const dismissToast = useCallback(
        ({withoutAnimation = false}: {withoutAnimation?: boolean} = {}) => {
            if (withoutAnimation) {
                dispatch({type: "ActuallyDismissActiveToast"});
            } else {
                dispatch({type: "StartDismissActiveToastAnimation"});
            }
        },
        [],
    );

    const reporter: ReporterWithoutContext = useMemo(() => {
        const reporter: ReporterWithoutContext = {
            cache: new DefaultWeakMap<AppContext, Reporter>(context => {
                const newReporter = {
                    showDialog: reporter.showDialog.bind(undefined, context),
                    hasDialogWithKey: reporter.hasDialogWithKey,
                    displayError: reporter.displayError.bind(undefined, context),
                    logErrorWithoutDisplaying: reporter.logErrorWithoutDisplaying.bind(
                        undefined,
                        context,
                    ),
                    showInfoToast: reporter.showInfoToast.bind(undefined, context),
                };

                return newReporter as Memo<typeof newReporter>;
            }),

            showDialog: (context, dialogProps) => {
                dispatch({
                    type: "ShowDialog",
                    dialogProps: {
                        ...dialogProps,
                        description:
                            typeof dialogProps.description === "object"
                                ? {...dialogProps.description, reportingContext: context}
                                : dialogProps.description,
                    },
                });
            },

            hasDialogWithKey: key => {
                return (
                    stateRef.current.activeDialog?.props.key === key ||
                    stateRef.current.dialogQueue.some(dialog => dialog.props.key === key)
                );
            },

            displayError: (context, title, error) => {
                dispatch({
                    type: "DisplayError",
                    time: new Date(),
                    title,
                    error,
                    reportingContext: context,
                });
            },

            logErrorWithoutDisplaying: (context, title, error) => {
                context.tracer.getRoot().logException(title, error);
            },

            showInfoToast: (context, message, options) => {
                dispatch({
                    type: "ShowToast",
                    time: new Date(),
                    toast: {
                        type: "Info",
                        message,
                        durationSeconds: options?.durationSeconds,
                    },
                });
            },
        };

        return reporter;
    }, []);

    const onAfterCloseByModalDialogIdRef = useRef<Map<number, () => void> | null>(null);

    // Call `onAfterClose` callbacks for dialogs that are no longer open.
    useEffect(() => {
        if (onAfterCloseByModalDialogIdRef.current) {
            for (const [id, onAfterClose] of onAfterCloseByModalDialogIdRef.current) {
                if (id === state.activeDialog?.id) {
                    continue;
                }
                if (state.dialogQueue.some(dialog => dialog.id === id)) {
                    continue;
                }

                onAfterCloseByModalDialogIdRef.current.delete(id);

                // If we have a callback for a dialog that isn't the active dialog and isn't in
                // the queue then finally call `onAfterClose`.
                try {
                    onAfterClose();
                } catch (error) {
                    scheduleUncaughtError(error);
                }
            }
        }

        if (state.activeDialog && state.activeDialog.props.onAfterClose) {
            onAfterCloseByModalDialogIdRef.current ??= new Map();

            onAfterCloseByModalDialogIdRef.current.set(
                state.activeDialog.id,
                state.activeDialog.props.onAfterClose,
            );
        }

        for (const dialog of state.dialogQueue) {
            if (dialog.props.onAfterClose) {
                onAfterCloseByModalDialogIdRef.current ??= new Map();
                onAfterCloseByModalDialogIdRef.current.set(dialog.id, dialog.props.onAfterClose);
            }
        }
    }, [state.activeDialog, state.dialogQueue]);

    return (
        <ReporterContext.Provider value={reporter}>
            {children}
            {state.activeDialog && (
                <ModalDialog
                    {...state.activeDialog.props}
                    key={state.activeDialog.id}
                    onClose={() => dispatch({type: "CloseActiveDialog"})}
                />
            )}
            {state.platform !== "mobile" && (
                <Box pointerEvents="none" position="absolute" inset="0" zIndex="60">
                    {state.activeToast && (
                        <Box
                            key={state.activeToast.startTime.toISOString()}
                            position="absolute"
                            left="0"
                            bottom="0"
                            paddingLeft="5"
                            paddingBottom="5"
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
                                    onDismiss={dismissToast}
                                />
                            </Box>
                        </Box>
                    )}
                </Box>
            )}
        </ReporterContext.Provider>
    );
}

// NOTE(calebmer): Toasts can only be rendered on desktop right now. Which is
// why they're a part of this `Reporter` abstraction. `Reporter` is responsible
// for providing cross-platform "report" methods which may use toasts (on
// desktop) and other UI on mobile.
function ToastView({
    toast,
    startTime,
    onDismiss,
}: {
    toast: Toast;
    startTime: Date;
    onDismiss: Memo<(options?: {withoutAnimation?: boolean}) => void>;
}) {
    const expirationTime = useMemo(
        () => addSeconds(startTime, toast.durationSeconds ?? defaultToastDurationSeconds),
        [startTime, toast.durationSeconds],
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

    const [isInitialRender, setIsInitialRender] = useState(true);
    useLayoutEffect(() => {
        setIsInitialRender(false);
    }, []);

    // If this is not a system error and has a display message (e.g.
    // `PermissionDeniedError`) then we don't show the red warning icon. Since this
    // error is probably expected.
    const withErrorIcon =
        toast.type === "Error" &&
        toast.error instanceof ErrorBase &&
        !isSystemError(toast.error) &&
        !!toast.error.displayMessage;

    return (
        <Box
            position="relative"
            maxWidth="128"
            className={greyElevated2ClassName}
            backgroundColor="grey-0"
            borderRadius="1"
            boxShadow="elevation-30"
            display="flex"
        >
            <Box flexGrow="1" alignSelf="center" display="flex" paddingX="3" paddingY="2">
                {withErrorIcon && (
                    <Box flexShrink="0" color="grey-50" paddingRight="1.5">
                        <ErrorIcon size={spacing["4"]} />
                    </Box>
                )}
                <Box flexGrow="1" role="alert">
                    {!isInitialRender &&
                        // [According to MDN][1], live regions (`role="alert"`, `role="status"`,
                        // `aria-live="assertive"`, `aria-live="polite"`) only notify users of assistive
                        // technology when the element updates. Not when it is added to the DOM. So we
                        // initially render without content then the element immediately re-renders with
                        // the alert content.
                        //
                        // [1]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Roles/alert_role
                        (toast.type === "Info" ? (
                            toast.message
                        ) : (
                            <ErrorDisplayMessageRenderer
                                error={toast.error}
                                fontSize="75"
                                // Add punctuation to the title since it was written standalone.
                                prefixMessage={`${toast.title}.`}
                                isSingleLine={true}
                            />
                        ))}
                </Box>
            </Box>
            <Box flexShrink="0" paddingTop="0.5" paddingBottom="1.5" paddingRight="0.5">
                <IconButton
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
        <Box position="relative" width="3" height="3" marginX="1">
            <Box position="absolute" inset="0" color="grey-10">
                <svg
                    xmlns="http://www.w3.org/2000/svg"
                    style={{
                        // Safari logs a warning when using `width` or `height` with rem units.
                        width: spacing["3"],
                        height: spacing["3"],
                    }}
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
                    style={{
                        // Safari logs a warning when using `width` or `height` with rem units.
                        width: spacing["3"],
                        height: spacing["3"],
                    }}
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
