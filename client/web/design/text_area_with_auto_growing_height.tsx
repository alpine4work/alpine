import {Ref, TextareaHTMLAttributes, forwardRef, useRef} from "react";
import {ScriptBeforeAppInitialRender} from "~/client/web/helpers/lifecycle/script_before_initial_app_render.js";
import {useLayoutEffectWithoutServerSideWarning} from "~/client/web/helpers/lifecycle/use_layout_effect_without_server_side_warning.js";
import {useMergedRefs} from "~/client/web/helpers/refs/use_merged_refs.js";
import {
    addResizeListenerForElement,
    removeResizeListenerForElement,
} from "~/client/web/helpers/use_resize_observer.js";
import {usePlatform} from "~/client/web/remix/platform_context.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.open_source.js";
import {safe} from "~/shared/helpers/string/safe_string.js";

const TextAreaWithAutoGrowingHeightForwardRef = forwardRef(TextAreaWithAutoGrowingHeight);
export {TextAreaWithAutoGrowingHeightForwardRef as TextAreaWithAutoGrowingHeight};

function TextAreaWithAutoGrowingHeight(
    props: TextareaHTMLAttributes<HTMLTextAreaElement>,
    externalRef: Ref<HTMLTextAreaElement>,
) {
    const platform = usePlatform();

    const internalRef = useRef<HTMLTextAreaElement>(null);

    useLayoutEffectWithoutServerSideWarning(() => {
        // Make sure we update the input's height whenever the text within changes.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        props.value;

        // If we switch between desktop and mobile then update the input's height.
        // Since font sizes will change.
        //
        // eslint-disable-next-line @typescript-eslint/no-unused-expressions
        platform;

        const element = assertExists(internalRef.current);

        // Set the height to 0px so `scrollHeight` recomputes to fit the content instead of
        // retaining the previous height. This makes sure when you delete content the
        // `<textarea>` shrinks.
        element.style.height = "0px";

        element.style.height = `${element.scrollHeight}px`;

        // Undo any scroll the browser may have made. We've observed on iOS WebKit will
        // sometimes scroll the `<textarea>` when you input a character.
        element.scrollTop = 0;
    }, [platform, props.value]);

    useLayoutEffectWithoutServerSideWarning(() => {
        const element = assertExists(internalRef.current);

        // we also set up a resize observer for the element because external factors can
        // cause the width to change, which needs to cascade to a height change too.
        let lastWidth = element.offsetWidth;
        const listener = () => {
            if (lastWidth === element.offsetWidth) return;
            lastWidth = element.offsetWidth;
            element.style.height = "0px";
            element.style.height = `${element.scrollHeight}px`;
        };

        addResizeListenerForElement(element, listener);

        return () => {
            removeResizeListenerForElement(element, listener);
        };
    }, []);

    return (
        <>
            <textarea
                {...props}
                ref={useMergedRefs(internalRef, externalRef)}
                style={{
                    ...props.style,
                    display: "block",
                    overflow: "hidden",
                    // The `<textarea>` will resize on its own. Don't render resize handles.
                    resize: "none",
                }}
                // Suppress hydration warning since `<ScriptBeforeAppInitialRender>` will set the
                // `height` inline style which disagrees with the initial React render.
                suppressHydrationWarning={true}
            />
            <ScriptBeforeAppInitialRender
                // Make sure the `<textarea>` has the proper height on server render.
                // eslint-disable-next-line cyberworlds/string-quotes
                script={safe`var element = document.currentScript.previousElementSibling; element.style.height = "0px"; element.style.height = element.scrollHeight + "px"`}
            />
        </>
    );
}
