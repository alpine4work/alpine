import classNames from "classnames";
import {CSSProperties, InputHTMLAttributes, Ref, forwardRef} from "react";

const InputWithAutoGrowingWidthForwardRef = forwardRef(InputWithAutoGrowingWidth);
export {InputWithAutoGrowingWidthForwardRef as InputWithAutoGrowingWidth};

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
                    // NOTE(calebmer): I've found adding an extra pixel of width helps with
                    // sub-pixel rendering which sometimes clips the text. Allow this padding value
                    // to be overridden.
                    paddingRight: 1,
                    ...textStyle,
                    height: 0,
                    opacity: 0,
                    pointerEvents: "none",
                    // Leading and trailing spaces should contribute to width.
                    whiteSpace: "pre",
                }}
            >
                {props.placeholder}
            </div>
            <div
                aria-hidden={true}
                className={textClassName}
                style={{
                    // NOTE(calebmer): I've found adding an extra pixel of width helps with
                    // sub-pixel rendering which sometimes clips the text. Allow this padding value
                    // to be overridden.
                    paddingRight: 1,
                    ...textStyle,
                    height: 0,
                    opacity: 0,
                    pointerEvents: "none",
                    // Leading and trailing spaces should contribute to width.
                    whiteSpace: "pre",
                }}
            >
                {props.value}
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
                    display: "inline-block",
                    width: "100%",
                }}
                className={classNames(props.className, textClassName)}
            />
        </div>
    );
}
