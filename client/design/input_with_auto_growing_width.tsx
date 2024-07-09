import classNames from "classnames";
import {CSSProperties, InputHTMLAttributes, Ref, forwardRef} from "react";
import {useIsMobile} from "~/client/remix/use_is_mobile.js";

const InputWithAutoGrowingWidthForwardRef = forwardRef(InputWithAutoGrowingWidth);
export {InputWithAutoGrowingWidthForwardRef as InputWithAutoGrowingWidth};

export function useInputWithAutoGrowingWidthSafeSpacerElement() {
    const isMobile = useIsMobile();
    if (!isMobile) return null;

    return (
        <span
            style={{
                display: "inline-block",
                // NOTE(calebmer): I've found adding a bit of extra width helps sub-pixel
                // rendering (which sometimes clips the text) and the iOS Safari cursor which
                // seems to add ~2px of width to input content. Can't use `paddingRight` since
                // `textClassName` or `textStyle` may add padding we don't want to override.
                //
                // To see the issues the [iOS Safari cursor causes here's a bug repro][1].
                // Notice how the input text shifts to the left and is clipped. This seems to
                // be because the iOS cursor takes horizontal space in the input.
                //
                // [1]: https://gist.github.com/calebmer/cfaa91c91a53e893a43e30d65d1c6b80
                width: 2,
            }}
        />
    );
}

function InputWithAutoGrowingWidth(
    {
        containerClassName,
        containerStyle,
        textClassName,
        textStyle,
        ...props
    }: InputHTMLAttributes<HTMLInputElement> & {
        containerClassName?: string;
        containerStyle?: CSSProperties;
        textClassName?: string;
        textStyle?: CSSProperties;
    },
    ref: Ref<HTMLInputElement>,
) {
    const inputWithAutoGrowingWidthSafeSpacerElement =
        useInputWithAutoGrowingWidthSafeSpacerElement();

    return (
        <div
            className={containerClassName}
            style={{
                ...containerStyle,
                maxWidth: "100%",
                overflow: "hidden",
                // The width of this element is determined by nested text boxes. The `<input>`
                // then uses the parent width as its own width.
                display: "inline-block",
            }}
        >
            <div
                aria-hidden={true}
                className={textClassName}
                style={{
                    ...textStyle,
                    height: 0,
                    opacity: 0,
                    pointerEvents: "none",
                    // Leading and trailing spaces should contribute to width.
                    whiteSpace: "pre",
                }}
            >
                {props.placeholder}
                {inputWithAutoGrowingWidthSafeSpacerElement}
            </div>
            <div
                aria-hidden={true}
                className={textClassName}
                style={{
                    ...textStyle,
                    height: 0,
                    opacity: 0,
                    pointerEvents: "none",
                    // Leading and trailing spaces should contribute to width.
                    whiteSpace: "pre",
                }}
            >
                {props.value}
                {inputWithAutoGrowingWidthSafeSpacerElement}
            </div>
            <input
                {...props}
                ref={ref}
                type="text"
                // By default `<input>` elements have a `min-width` determined by the `size`
                // property. We want our `<input>`s `min-width` to be determined by our CSS
                // so set it to a small value as not to matter.
                // https://stackoverflow.com/questions/29470676/why-doesnt-the-input-element-respect-min-width
                size={1}
                style={{
                    ...props.style,
                    ...textStyle,
                    display: "inline-block",
                    width: "100%",
                }}
                className={classNames(props.className, textClassName)}
            />
        </div>
    );
}
