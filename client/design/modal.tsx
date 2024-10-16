import classNames from "classnames";
import {X} from "phosphor-react";
import {ReactNode} from "react";
import {Box} from "~/client/design/box.js";
import {IconButton} from "~/client/design/icon_button.js";
import {ModalContainer} from "~/client/design/modal_container.js";
import {greyElevated1ClassName, sprinkles} from "~/client/styles/styles.js";
import {RemLength, Spacing, isRemLength, spacing} from "~/shared/design/spacing.js";

export const defaultModalMaxWidth: Spacing = "128";

/**
 * A view which takes over the entire screen and blocks interaction with the
 * content underneath while it is open.
 *
 * Has an underlay which when clicked will close the modal.
 */
export function Modal({
    maxWidth = defaultModalMaxWidth,
    height = "auto",
    maxHeight = "full",
    borderRadius = "1.5",
    ...props
}: {
    /**
     * The contents of the modal. If the contents are too big for the screen then
     * the content area will scroll.
     */
    children?:
        | ReactNode
        | ((props: {
              onCloseWithAnimation: () => void;
              onCloseWithoutAnimation: () => void;
          }) => ReactNode);

    /**
     * Callback that will close and unmount the modal. The parent component is
     * expected to manage the modal lifecycle. May be called after a short delay if
     * the modal is animating out.
     */
    onClose: () => void;

    /**
     * The id for an element in the DOM that describes this modal for assistive
     * technology. See [`aria-describedby`][1].
     *
     * [1]: https://developer.mozilla.org/en-US/docs/Web/Accessibility/ARIA/Attributes/aria-describedby
     */
    "aria-describedby"?: string;

    /**
     * The maximum width for this modal. Defaults to `128`.
     */
    maxWidth?: Spacing | RemLength | "full";

    /**
     * How height is handled for this modal. Defaults to `auto` which means the
     * modal height will be as big as it's content height. If you want the modal's
     * height to stretch across all available space then use `full`.
     *
     * `width` behaves as `full` but you can't configure it.
     */
    height?: "auto" | "full";

    /**
     * The maximum height of our modal. Defaults to `full`.
     *
     * Useful if you set `height="full"` to constrain the height of your modal.
     */
    maxHeight?: Spacing | RemLength | "full";

    /**
     * Border radius for the modal content.
     */
    borderRadius?: "1.5" | "2";

    /**
     * The modal will never animate when opening if set to true. Otherwise we fade
     * in the modal when opened.
     */
    withoutOpenAnimation?: boolean;

    /**
     * The modal will never animate when closing if set to true. Otherwise we fade
     * out the modal when closed indirectly.
     */
    withoutCloseAnimation?: boolean;

    /**
     * Don't include the close button in the top right corner. Useful if you want
     * to reduce decision overload. The user can still use the keyboard or click
     * the background to close the modal. We just won't have an explicit action.
     */
    withoutCloseButton?: boolean;

    /**
     * If true, disables all close interactions. Include the close button, clicking
     * the underlay to close, and pressing the escape key to close.
     *
     * Defaults to false. Automatically sets `withoutCloseButton` to true.
     */
    withoutCloseInteractions?: boolean;
} & (
    | {
          /**
           * A label exposed to assistive technology (through `aria-label`) when
           * there is no visible label for the element.
           */
          "aria-label": string;
          "aria-labelledby"?: undefined;
      }
    | {
          /**
           * A reference to another element (through `aria-labelledby`) with a
           * visible label for this element. Usually a title element like an `<h2>`
           * for modals.
           */
          "aria-labelledby": string;
          "aria-label"?: undefined;
      }
)) {
    return (
        <ModalContainer
            {...props}
            className={classNames(
                greyElevated1ClassName,
                sprinkles({
                    position: "relative",
                    zIndex: "0",
                    width: "full",
                    height,
                    backgroundColor: "grey-0",
                    boxShadow: "elevation-40",
                    borderRadius,
                    display: "flex",
                    overflow: "hidden",
                }),
            )}
            style={{
                maxWidth:
                    maxWidth === "full"
                        ? "100%"
                        : isRemLength(maxWidth)
                        ? maxWidth
                        : spacing[maxWidth],
                maxHeight:
                    maxHeight === "full"
                        ? "100%"
                        : isRemLength(maxHeight)
                        ? maxHeight
                        : spacing[maxHeight],
            }}
        >
            {!props.withoutCloseInteractions && !props.withoutCloseButton
                ? props.children
                : state => (
                      <>
                          {typeof props.children === "function"
                              ? props.children(state)
                              : props.children}
                          <Box position="absolute" top="1.5" right="1.5">
                              <IconButton
                                  size="xs"
                                  description="Close"
                                  withoutTooltip={true}
                                  // Our animation principle is to respond to user input immediately
                                  // without animation.
                                  onPress={state.onCloseWithoutAnimation}
                              >
                                  <X />
                              </IconButton>
                          </Box>
                      </>
                  )}
        </ModalContainer>
    );
}
