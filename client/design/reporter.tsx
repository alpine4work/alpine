import {addSeconds} from "date-fns";
import {Info, X} from "phosphor-react";
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
import {AppContext, useAppContext} from "~/client/context/app_context.js";
import {Box} from "~/client/design/box.js";
import {ErrorDisplayMessageRenderer} from "~/client/design/error_display_message_renderer.js";
import {ErrorIcon} from "~/client/design/error_icon.js";
import {IconButton} from "~/client/design/icon_button.js";
import {ModalDialog, ModalDialogProps} from "~/client/design/modal_dialog.js";
import {perceivedAsInstantLimitMs} from "~/client/design/timing_constants.js";
import {markMemoIfNotRendering} from "~/client/helpers/lifecycle/mark_memo_if_not_rendering.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";
import {spacing} from "~/shared/design/spacing.js";
import {ErrorBase, InternalError, UnimplementedError} from "~/shared/error/error.js";
import {isSystemError} from "~/shared/error/is_system_error_code.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {cast} from "~/shared/helpers/control/cast.js";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {DefaultWeakMap} from "~/shared/helpers/map/default_weak_map.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {greyElevated2ClassName, toastStyles} from "~/shared/styles/styles.js";

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
const defaultErrorToastDurationSeconds = 6;

export type ReporterModalDialogProps = Omit<ModalDialogProps, "onClose"> & {readonly key?: unknown};

/**
 * The reporter abstraction is used for conveniently reporting some message to
 * the user from anywhere in the product. Primarily, it's used for reporting
 * errors to the user which will use a different design depending on the
 * platform.
 *
 * You may also use the reporter object to show a dialog from anywhere as
 * opposed to rendering a `<ModalDialog>` yourself. In the future you may also
 * use the reporter to show a non-error toast on desktop platforms (though not
 * on mobile).
 */
export type Reporter = Memo<{
    /**
     * Present a dialog using the `<ModalDialog>` component. You may call this as
     * an alternative to rendering a `<ModalDialog>` component yourself if you're
     * in a position where doing so may be complicated.
     */
    showDialog(dialogProps: ReporterModalDialogProps): void;

    /**
     * Are we showing a dialog with the provided key? Returns true if we have an
     * active dialog with the provided key or if we have a dialog queued with the
     * provided key.
     */
    hasDialogWithKey(key: unknown): boolean;

    /**
     * Display an error to the user.
     *
     * `title` should describe what happened in plain English for the user. Follow
     * the "what happened" part of an error message according to [Adobe
     * Spectrum's][1] error content guidelines.
     *
     * `title` should not include ending punctuation. Ending punctuation will be
     * added for you.
     *
     * `error` is the actual error object. If the error contains a `displayMessage`
     * then we'll show that to the user. Otherwise we'll show an "unknown error
     * ocurred" kind of message.
     *
     * On desktop the error is displayed as a toast which is minimally disruptive
     * to the user's experience. On mobile the error is displayed in a blocking
     * modal.
     *
     * [1]: https://spectrum.adobe.com/page/writing-for-errors/#What-happened
     */
    displayError(title: string, error: unknown): void;

    /**
     * Send an error to our logging provider without displaying it to the user.
     * If the error isn't noticeable to the user you should use this to avoid
     * disrupting their experience.
     */
    logErrorWithoutDisplaying(title: string, error: unknown): void;
}>;

// A `ReporterWithoutContext` object needs to be provided an `AppContext` since
// it doesn't know itself the context in which its methods are called.
type ReporterWithoutContext = {
    // Cache of `Reporter` objects by `AppContext`.
    readonly cache: DefaultWeakMap<AppContext, Reporter>;

    readonly showDialog: (context: AppContext, dialogProps: ReporterModalDialogProps) => void;
    readonly hasDialogWithKey: (key: unknown) => boolean;
    readonly displayError: (context: AppContext, title: string, error: unknown) => void;
    readonly logErrorWithoutDisplaying: (
        context: AppContext,
        title: string,
        error: unknown,
    ) => void;
};

const ReporterContext = createContext<ReporterWithoutContext | null>(null);

const reporterForTest: Reporter | null = import.meta.jest
    ? markMemoIfNotRendering({
          showDialog: () => {
              throw new UnimplementedError("Can't present dialog in test");
          },
          hasDialogWithKey: () => {
              return false;
          },
          displayError: () => {
              throw new UnimplementedError("Can't display error in test");
          },
          logErrorWithoutDisplaying: () => {
              throw new UnimplementedError("Can't log error in test");
          },
      })
    : null;

export function useReporter(): Reporter {
    const context = useAppContext();
    const reporter = useContext(ReporterContext);

    if (reporter === null) {
        // In unit tests, throw only when `showToast()` is called.
        if (reporterForTest) return reporterForTest;

        throw new InternalError("Must render in a `<ReporterContextProvider>` to display errors");
    }

    return reporter.cache.getOrSetDefault(context);
}

/**
 * Toasts display brief, temporary notifications. They're meant to be noticed
 * but not disrupt a user's experience.
 */
type Toast = ErrorToast;

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
          readonly isMobile: true;
          readonly activeToast?: undefined;
      }
    | {
          readonly isMobile: false;
          readonly activeToast: {
              readonly toast: Toast;
              readonly startTime: Date;
              readonly durationSeconds: number;
              readonly isAnimatingOut: boolean;
          } | null;
          readonly toastQueue: ReadonlyArray<Toast>;
      }
);

const desktopInitialReporterState: ReporterState = {
    isMobile: false,
    activeDialog: null,
    dialogQueue: [],
    activeToast: null,
    toastQueue: [],
};

const mobileInitialReporterState: ReporterState = {
    isMobile: true,
    activeDialog: null,
    dialogQueue: [],
};

type ReporterAction =
    | {
          readonly type: "SetIsMobile";
          readonly isMobile: boolean;
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
        case "SetIsMobile": {
            if (state.isMobile === action.isMobile) return state;

            // Switching to mobile immediately throws away all pending toasts.
            if (action.isMobile) {
                return {
                    isMobile: true,
                    activeDialog: state.activeDialog,
                    dialogQueue: state.dialogQueue,
                };
            } else {
                return {
                    isMobile: false,
                    activeDialog: state.activeDialog,
                    dialogQueue: state.dialogQueue,
                    activeToast: null,
                    toastQueue: [],
                };
            }
        }
        case "DisplayError": {
            if (state.isMobile) {
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
            if (state.isMobile) return state;

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
                        durationSeconds: defaultErrorToastDurationSeconds,
                        isAnimatingOut: false,
                    },
                };
            }
        }
        case "StartDismissActiveToastAnimation": {
            if (state.isMobile) return state;
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
            if (state.isMobile) return state;
            if (!state.activeToast) return state;

            if (state.toastQueue[0]) {
                return {
                    ...state,
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
                ...state,
                activeToast: null,
            };
        }
        default:
            throw exhaustive(action);
    }
}

export function ReporterContextProvider({children}: {children?: ReactNode}) {
    const isMobile = useIsMobile();

    const [actualState, dispatch] = useReducer(
        reduceReporterState,
        isMobile ? mobileInitialReporterState : desktopInitialReporterState,
    );
    let state = actualState;

    if (actualState.isMobile !== isMobile) {
        const action: ReporterAction = {type: "SetIsMobile", isMobile};
        dispatch(action);
        state = reduceReporterState(state, action);
    }

    const stateRef = useRef(state);
    useLayoutEffectWithoutServerSideWarning(() => {
        stateRef.current = state;
    });

    useEffect(() => {
        if (state.isMobile || !state.activeToast || !state.activeToast.isAnimatingOut) return;

        const timeout = createTimeout(() => {
            dispatch({type: "ActuallyDismissActiveToast"});
        }, toastStyles.toastAnimateOutDuration + perceivedAsInstantLimitMs);

        return () => timeout.clear();
    }, [state.activeToast, state.isMobile]);

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
                context.tracer.getRoot().logUncaughtException(title, error);
            },
        };

        return reporter;
    }, []);

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
            {!state.isMobile && (
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

    // If this is not a system error and has a display message (e.g.
    // `PermissionDeniedError`) then we don't show the red warning icon. Since this
    // error is probably expected.
    const dontShowErrorIcon =
        toast.error instanceof ErrorBase &&
        !isSystemError(toast.error) &&
        !!toast.error.displayMessage;

    return (
        <Box
            position="relative"
            maxWidth="128"
            className={greyElevated2ClassName}
            backgroundColor="grey-0"
            borderRadius="base"
            boxShadow="elevation-30"
            display="flex"
        >
            <Box flexGrow="1" alignSelf="center" display="flex" paddingX="3" paddingY="2">
                <Box flexShrink="0" color="grey-50" paddingRight="1.5">
                    <Box position="relative" style={{top: 1}}>
                        {dontShowErrorIcon ? (
                            <Info size={spacing["4"]} />
                        ) : (
                            <ErrorIcon size={spacing["4"]} />
                        )}
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
            <Box flexShrink="0" paddingTop="1" paddingBottom="2" paddingRight="1" paddingLeft="0">
                <IconButton
                    variant="quiet-above-grey-5-dark-background"
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
