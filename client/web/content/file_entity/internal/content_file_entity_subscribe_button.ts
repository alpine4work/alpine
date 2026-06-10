import classNames from "classnames";
import {addUnfocusableButtonBehaviorToElement} from "~/client/web/content/state/add_unfocusable_button_behavior_to_element.js";
import {Reporter} from "~/client/web/design/reporter.js";
import {bellIconSvg} from "~/client/web/icons/bell_icon_svg.js";
import {bellRingingIconSvg} from "~/client/web/icons/bell_ringing_icon_svg.js";
import {createSvgHtmlGenerator} from "~/client/web/icons/create_svg_html_generator.js";
import {spinnerGapIconSvg} from "~/client/web/icons/spinner_gap_icon_svg.js";
import {contentStyles, spinAnimationClassName} from "~/client/web/styles/styles.js";
import {delayLoadingIndicatorLimitMs} from "~/shared/design/core/timing.js";
import {runPromiseWithoutAwaiting} from "~/shared/helpers/async/run_promise_without_awaiting.js";
import {createTimeout} from "~/shared/helpers/async/timeout.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {
    HtmlContainerGenerator,
    HtmlElementGenerator,
} from "~/shared/helpers/html/html_generator.js";

export function renderContentFileEntitySubscribeButton(
    containerHtml: HtmlContainerGenerator,
    {isVisible, isSubscribed}: {isVisible: boolean; isSubscribed: boolean},
) {
    const subscribeButtonHtml = containerHtml.appendChild(new HtmlElementGenerator("div"));

    subscribeButtonHtml.setAttribute(
        "class",
        contentStyles.fileEntityPreviewSubscribeButtonClassName,
    );

    subscribeButtonHtml.setAttribute("style", `display: ${isVisible ? "flex" : "none"}`);

    subscribeButtonHtml.setAttribute("data-subscribed", JSON.stringify(isSubscribed));

    subscribeButtonHtml.appendChild(
        createSvgHtmlGenerator(
            bellIconSvg({
                weight: "bold",
                className: contentStyles.fileEntityPreviewSubscribeButtonBellIconClassName,
            }),
        ),
    );

    subscribeButtonHtml.appendChild(
        createSvgHtmlGenerator(
            bellRingingIconSvg({
                weight: "regular",
                className: contentStyles.fileEntityPreviewSubscribeButtonBellRingingIconClassName,
            }),
        ),
    );

    subscribeButtonHtml.appendChild(
        createSvgHtmlGenerator(
            spinnerGapIconSvg({
                className: classNames(
                    spinAnimationClassName,
                    contentStyles.fileEntityPreviewSubscribeButtonSpinnerGapIconClassName,
                ),
            }),
        ),
    );
}

export function addContentFileEntitySubscribeButtonBehavior(
    element: HTMLElement,
    {
        getReporter,
        isInert,
        subscribe,
        unsubscribe,
    }: {
        getReporter: () => Reporter;
        isInert: boolean;
        subscribe: () => Promise<unknown>;
        unsubscribe: () => Promise<unknown>;
    },
) {
    const subscribeButtonElement = assertExists(
        element.getElementsByClassName(contentStyles.fileEntityPreviewSubscribeButtonClassName)[0],
    ) as HTMLDivElement;

    let cleanupSubscribeButton: (() => void) | undefined;
    if (!isInert) {
        cleanupSubscribeButton = addUnfocusableButtonBehaviorToElement(subscribeButtonElement, {
            pressClassName: contentStyles.fileEntityPreviewSubscribeButtonPressedClassName,
            onPress: () => {
                // Only run one async operation at a time...
                if (subscribeButtonElement.hasAttribute("data-loading")) return;

                const isSubscribed: boolean = JSON.parse(
                    subscribeButtonElement.getAttribute("data-subscribed-override") ??
                        subscribeButtonElement.getAttribute("data-subscribed") ??
                        "false",
                );

                const setIsSubscribed = (isSubscribed: boolean) => {
                    // Our local `isSubscribed` state is saved in the DOM as a data attribute. We need
                    // to pick a name for the data attribute which doesn't conflict with
                    // `data-subscribed` which is managed by `HtmlGenerator`. If
                    // `renderContentFileChannelEntityPreview()` reruns then we don't want it to
                    // override our local `isSubscribed` state when patching nodes.
                    //
                    // Behaviors functions like this have to manage state in the DOM since we're not a
                    // traditional stateful React component.
                    subscribeButtonElement.setAttribute(
                        "data-subscribed-override",
                        JSON.stringify(isSubscribed),
                    );
                };

                runPromiseWithoutAwaiting(async () => {
                    subscribeButtonElement.setAttribute("data-loading", "");

                    const timeout = createTimeout(() => {
                        subscribeButtonElement.setAttribute("data-loading-indicator", "");
                    }, delayLoadingIndicatorLimitMs);

                    try {
                        // Optimistically update the button.
                        setIsSubscribed(!isSubscribed);

                        if (isSubscribed) {
                            await unsubscribe();
                        } else {
                            await subscribe();
                        }
                    } catch (error) {
                        // If the request failed then revert our button back to the original state.
                        setIsSubscribed(isSubscribed);

                        getReporter().displayError(
                            !isSubscribed ? "Couldn\u2019t subscribe" : "Couldn\u2019t unsubscribe",
                            error,
                        );
                    } finally {
                        timeout.clear();
                        subscribeButtonElement.removeAttribute("data-loading");
                        subscribeButtonElement.removeAttribute("data-loading-indicator");
                    }
                });
            },
        });
    }

    return () => {
        cleanupSubscribeButton?.();
    };
}
