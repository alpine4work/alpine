import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";

export function useInputWithAutoGrowingWidthSafeSpacerElement() {
    const platform = useSpacingScale();
    if (platform !== "large") return null;

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
