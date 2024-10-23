import {ReactElement, ReactNode, Ref, RefCallback, RefObject} from "react";
import {MenuAction} from "~/client/design/menu.js";
import {OverlayTriggerButtonState} from "~/client/design/overlay_trigger_button.js";
import {ScrollbarInsetDynamic} from "~/client/design/scrollbar.js";
import {FontSize} from "~/shared/design/core/fonts.js";
import {RemLength, Spacing} from "~/shared/design/core/spacing.js";

export type NavigationBarRef = {
    /**
     * Get the number of visible pixels for this navigation bar. Includes top safe
     * area inset since the navigation bar is always visible in the safe area.
     */
    getVisibleHeight(): number;

    /**
     * Get the number of visible pixels when this navigation bar is fully expanded.
     */
    getMaxVisibleHeight(): number;
};

export type NavigationBarProps<TitleBoundaryElement extends HTMLElement = HTMLDivElement> = {
    /**
     * A ref for interacting with the navigation bar when mounted.
     */
    ref?: Ref<NavigationBarRef>;

    /**
     * Is the navigation bar actually rendered? If true then none of the navigation
     * bar logic runs and you don't need to use `navigationBarResult`.
     *
     * `ref` will not be initialized if true.
     */
    isDisabled?: boolean;

    /**
     * Should the navigation bar use a mobile layout even while on desktop? This is
     * typically set to true in peeks. Peeks are visible on desktop but need a
     * mobile-like layout.
     *
     * We use a mobile layout when in mobile mode regardless of whether this is
     * true or not.
     */
    withMobileLayout: boolean;

    /**
     * The title to display in the navigation bar. It will be truncated based
     * on how much room is in the navigation bar.
     *
     * The title will not be displayed when scrolled to the top of the view.
     */
    title?: ReactNode;

    /**
     * The title only displays once the user has scrolled past this element. When
     * crossing this boundary the title animates in/out.
     */
    titleBoundaryRef?: RefObject<TitleBoundaryElement>;

    /**
     * The title only displays once the user has scrolled this distance past the
     * title boundary element's top.
     */
    titleBoundaryMarginTop?: Spacing | RemLength;

    /**
     * Don't let the title disappear when the navigation bar is scrolled to the
     * top. This can lead to some cleaner designs.
     */
    withoutDisappearingTitle?: boolean;

    /**
     * A secondary title we render under the main title at a smaller size. Used to
     * add a bit of extra detail.
     */
    subtitle?: ReactNode;

    /**
     * Actions that are made available to the user in a menu button at the right of
     * the navigation bar. These are secondary and tertiary actions where it
     * doesn't make sense to give them their own screen space.
     */
    menuActions?: ReadonlyArray<MenuAction> | ReadonlyArray<ReadonlyArray<MenuAction>>;

    /**
     * Called whenever the menu opens/closes. Useful if you want to change how
     * something is rendered when the menu navigation bar is open.
     */
    onMenuStateChange?: (state: OverlayTriggerButtonState) => void;

    /**
     * Configures the behavior of the share button in the navigation bar. If not
     * provided then there's no share button in the navigation bar.
     */
    // TODO(calebmer): Currently the share button is unimplemented. When we add
    // implementation this object will configure updating share properties
    // and such.
    shareButton?: {};

    /**
     * The sticky banner element will be rendered underneath the navigation bar and
     * will continue to be visible as the user scrolls.
     */
    stickyBanner?: ReactNode;

    /**
     * If provided, completely replace the actions in this navigation bar's content
     * (which includes `menuActions` and `shareButton`) with the contents of this
     * node.
     *
     * Useful if you're entering an edit modality and need controls to exit the
     * editing modality.
     */
    replaceActions?: ReactNode;

    /**
     * If provided, allows for another action and icon button in the navigation
     * bar's content. Rendered with the `<IconButton>` component. Allows us to
     * configure a subset of the `<IconButton>`'s props, but not modify
     * size or layout.
     */
    extraIconButton?: {
        icon: ReactNode;
        description: string;
        pressErrorTitle: string;
        onPress: () => Promise<void>;
    };

    /**
     * How do we justify title contents? Defaults to `center` on mobile and
     * `flex-start` on desktop. Override if you want the same behavior on both
     * platforms.
     */
    titleJustifyContent?: "center" | "flex-start";

    /**
     * Only rendered on desktop (not mobile).
     *
     * Controls at the far left of the navigation bar that renders at the top of
     * our content and moves with the navigation bar. The title goes to the right
     * of these controls.
     *
     * For example, tasks use the status button as a desktop control. So the status
     * button renders at the very top of the task and when the user scrolls it's
     * also a part of the navigation bar.
     */
    desktopControls?: ReactNode;

    /**
     * The amount of space all content in the navigation bar can occupy on desktop.
     * This also has the effect of centering the title container (of this width)
     * when set.
     *
     * The difference between `desktopMaxWidth` and `desktopTitleMaxWidth` is that
     * if `desktopTitleMaxWidth` is set then `menuActions` and `shareButton` will
     * be aligned with the right side of the screen but if `desktopMaxWidth` is set
     * then `menuActions` and `shareButton` are within the max width.
     */
    desktopMaxWidth?: Spacing | RemLength;

    /**
     * The amount of space the title can occupy on desktop. This also has the
     * effect of centering the title container (of this width) when set.
     */
    desktopTitleMaxWidth?: Spacing | RemLength;

    /**
     * When using `desktopTitleMaxWidth` we offset the title from the center by
     * this much. Pushing the title to the left by half this value. It's used when
     * your content is optically centered (disregarding the space layout sidebar
     * width) to make sure the navigation bar title is optically centered as well.
     */
    desktopTitleMaxWidthCenterOffset?: Spacing | RemLength;

    /**
     * Font size to use for the title on desktop.
     */
    desktopTitleFontSize?: FontSize;

    /**
     * Font weight to use for the title on desktop.
     */
    desktopTitleFontWeight?: "semi-bold" | "bold";

    /**
     * Slop we add to the left of the title element. You can use this if you don't
     * want the title's `overflow="hidden"` to clip some UI the title renders to
     * the left.
     */
    desktopTitleLeftSlop?: Spacing;

    /**
     * Extra scroll space added above the navigation bar on desktop. Similar to safe
     * area inset but the navigation bar doesn't cover this area when scrolled.
     */
    desktopMarginTop?: Spacing | RemLength;

    /**
     * Don't render a back button on mobile. Only set this to true for top level
     * mobile tab routes.
     */
    withoutMobileBackButton?: boolean;

    /**
     * By default, the navigation bar on mobile has a back button which calls
     * `navigate(-1)`. If you'd like to provide custom back navigation behavior
     * then you may pass this prop which will switch the back button to a "Cancel"
     * button that calls the function when pressed.
     *
     * For instance, if you use this in a `<MobileFullScreenModal>` you need to
     * close the modal instead of calling `navigate(-1)`.
     */
    onMobileCancel?: () => void;

    /**
     * Provide a property to control when the navigation bar stayes
     * opaque. In some cases we do not want the navigation bar to become
     * transparent.
     */
    isAlwaysOpaque?: boolean;
};

export type NavigationBarResult = {
    /**
     * (Required) Attach this ref to the scroll view the navigation bar renders
     * on top of.
     */
    scrollViewRef: RefCallback<HTMLElement>;

    /**
     * (Required) This element should be rendered inside a `position: relative`
     * container of all content in the scroll view. It can't be rendered as a
     * direct child of the scroll view.
     *
     * For example, this works:
     *
     * ```
     * <div ref={scrollViewRef} style={{overflowY: "auto"}}>
     *     <div style={{position: "relative"}}>
     *         {navigationBar}
     *         {/* Other children... *\/}
     *     </div>
     * </div>
     * ```
     *
     * This does not work!
     *
     * ```
     * <div ref={scrollViewRef} style={{overflowY: "auto", position: "relative"}}>
     *     {navigationBar}
     *     {/* Other children... *\/}
     * </div>
     * ```
     *
     * `navigationBar` needs to be 100% height of scrollable content. Not 100%
     * height of the scrollable window.
     *
     * If you're attaching a navigation bar to a `<VirtualizedScrollView>` then
     * `navigationBar` may be put in the `extraChildren` prop.
     */
    navigationBar: ReactElement | null;

    /**
     * (Required) The `insetTop` value to pass to `useScrollbar()`. Otherwise the
     * custom scrollbar may sometimes overlap the header which looks weird. You are
     * expected to pass this to `useScrollbar()`.
     */
    scrollbarInsetTop?: ScrollbarInsetDynamic;
};
