import {ReactElement, ReactNode, Ref, forwardRef} from "react";
import {Menu, MenuActions, MenuMaxHeight, MenuSize} from "~/client/web/design/menu.js";
import {OverlayPlacement} from "~/client/web/design/overlay.js";
import {
    OverlayTriggerButton,
    OverlayTriggerButtonChildrenProps,
    OverlayTriggerButtonRef,
    OverlayTriggerButtonState,
} from "~/client/web/design/overlay_trigger_button.js";
import {defaultTooltipOffset} from "~/client/web/design/tooltip.js";
import {ParsableRemLength} from "~/shared/design/core/spacing.js";

const MenuButtonForwardRef = forwardRef(MenuButton);
export {MenuButtonForwardRef as MenuButton};

/**
 * A menu button is a button which opens a menu overlay. The menu overlay
 * contains a list of actions which may be selected by the user.
 *
 * Implements the [WAI-ARIA menu button pattern][1].
 *
 * [1]: https://www.w3.org/WAI/ARIA/apg/patterns/menubar/button
 */
function MenuButton(
    {
        actions,
        placement = "bottom-start",
        size = "base",
        maxHeight,
        offset = defaultTooltipOffset,
        offsetAlong,
        withoutButtonElementRequirement,
        children,
        onClose,
        onStateChange,
        shouldNotCloseAfterActionPress,
        extraOverlayTop,
        extraOverlayBottom,
    }: {
        /**
         * All the actions available in a menu's popup. When clicking on the button
         * element to open
         *
         * If you have nested arrays then each sub-array will form a section with a
         * divider between sections.
         */
        actions: MenuActions | (() => MenuActions);

        /**
         * Where should the menu overlay be placed relative to the target element?
         * Defaults to `bottom-start`.
         */
        placement?: OverlayPlacement;

        /**
         * The size of our menu. Defaults to `base`.
         *
         * On mobile, `base` menus get larger to accommodate less precise input
         * mechanisms (fingers). Items grow to `lg` size even if the menu width as a
         * whole doesn't.
         */
        size?: MenuSize;

        /**
         * The maximum height of the menu. If none is provided the menu will grow
         * indefinitely.
         */
        maxHeight?: MenuMaxHeight;

        /**
         * Offset of the menu from the target.
         *
         * Defaults to the same thing as tooltips.
         */
        offset?: ParsableRemLength;

        /**
         * How far the offset should move along the reference.
         *
         * See the [demo][1] here.
         *
         * [1]: https://popper.js.org/docs/v2/modifiers/offset/#demo
         */
        offsetAlong?: ParsableRemLength;

        /**
         * Disable the requirement that `children` must be a `<button>` element.
         */
        withoutButtonElementRequirement?: boolean;

        /**
         * Should the menu close after an action is pressed? By default the menu closes
         * after an action is pressed but you may set this to true to stop that
         * behavior.
         */
        shouldNotCloseAfterActionPress?: boolean;

        /**
         * Some extra DOM to put at the top of the menu overlay. Useful if you
         * need some particularly custom in your menu.
         */
        extraOverlayTop?: ReactNode;

        /**
         * Some extra DOM to put at the bottom of the menu overlay. Useful if you
         * need some particularly custom in your menu.
         */
        extraOverlayBottom?: ReactNode;

        /**
         * The button element which opens and closes the menu. Must provide a ref to
         * an HTML `<button>` element or we will throw an error.
         */
        children: ReactElement | ((props: OverlayTriggerButtonChildrenProps) => ReactElement);

        /**
         * Called before the overlay closes. Like when a click happens outside the
         * overlay.
         */
        onClose?: (options: {withoutAnimation: boolean}) => void;

        /**
         * Observe the menu's internal state.
         */
        onStateChange?: (state: OverlayTriggerButtonState) => void;
    },
    ref: Ref<OverlayTriggerButtonRef>,
) {
    return (
        <OverlayTriggerButton
            ref={ref}
            aria-haspopup="menu"
            placement={placement}
            offset={offset}
            offsetAlong={offsetAlong}
            withoutButtonElementRequirement={withoutButtonElementRequirement}
            onClose={onClose}
            onStateChange={onStateChange}
            overlay={({onCloseWithAnimation, onCloseWithoutAnimation}) => (
                <Menu
                    actions={actions}
                    placement={placement}
                    size={size}
                    maxHeight={maxHeight}
                    onCloseWithAnimation={onCloseWithAnimation}
                    onCloseWithoutAnimation={onCloseWithoutAnimation}
                    shouldNotCloseAfterActionPress={shouldNotCloseAfterActionPress}
                    extraTop={extraOverlayTop}
                    extraBottom={extraOverlayBottom}
                />
            )}
        >
            {children}
        </OverlayTriggerButton>
    );
}
