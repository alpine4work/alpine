import {Memo, ReactElement, ReactNode, Ref, RefCallback} from "react";
import {MenuAction} from "~/client/web/design/menu.js";
import {ScrollbarInsetDynamic} from "~/client/web/design/scrollbar.js";
import {InheritedAccessPolicyExplanations} from "~/client/web/navigation/inherited_access_policy_explanations.js";
import {
    AccessLevel,
    AccessPolicy,
    AccessPolicyWithoutGenerations,
} from "~/shared/access/access_policy.js";
import {ShareNotification} from "~/shared/access/share_notification.js";
import {FontSize} from "~/shared/design/core/fonts.js";
import {RemLength, Spacing} from "~/shared/design/core/spacing.js";
import {FileEntityId} from "~/shared/files/file_entity_id.js";
import {MaybePromise} from "~/shared/helpers/types/maybe_promise.js";
import {MaybeThunk} from "~/shared/helpers/types/maybe_thunk.js";

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

export type NavigationBarShareButtonProps = {
    readonly entityNoun: string;
    readonly entityId: FileEntityId;
    readonly accessLevelText?: Record<AccessLevel, string>;
    readonly accessPolicy: AccessPolicy;
    readonly inherited?: {
        readonly accessPolicy: AccessPolicyWithoutGenerations;
        readonly explanations: InheritedAccessPolicyExplanations;
    };
    readonly onAccessPolicyChange: (
        // The `notification` argument comes first to make it harder for the
        // implementation of this function to ignore the `notification` argument.
        notification: ShareNotification | null,
        accessPolicy: AccessPolicy,
    ) => MaybePromise<void>;
    readonly isReadOnly?: boolean;
    readonly withoutEditAccessLevel?: boolean;
    readonly withHiddenCommentAccessLevel?: boolean;
    readonly onCopyLink: () => MaybePromise<void>;
};

export type NavigationBarProps = {
    /**
     * A ref for interacting with the navigation bar when mounted.
     */
    readonly ref?: Ref<NavigationBarRef>;

    /**
     * Is the navigation bar actually rendered? If true then none of the navigation
     * bar logic runs and you don't need to use `navigationBarResult`.
     *
     * `ref` will not be initialized if true.
     */
    readonly isDisabled?: boolean;

    /**
     * When true, the navigation bar will scroll away when you scroll down and will
     * scroll back when you scroll up.
     *
     * By default this is `true` on mobile and `false` on desktop. Since scrolling
     * away the navigation bar feels natural on a touch screen and lets the user
     * see more content. However, on desktop it doesn't feel natural and we have
     * enough screen space that it doesn't hurt to always show the navigation bar.
     *
     * Another argument for allowing scroll away on mobile but not desktop: on
     * mobile the user is always focused on one task. Hiding the navigation bar
     * helps them complete their one task. However, on desktop users are frequently
     * multitasking. If we hide the navigation bar in a peek, for instance, if the
     * user's attention leaves the peek when they come back to the peek they may
     * have forgotten what the subject of the peek is.
     *
     * Scroll away behavior is the main purpose of our navigation bar hook. Since
     * it's a complex interaction. Otherwise it would be easy for every route that
     * needs a navigation bar to render `<NavigationBarContent>` themselves.
     */
    readonly withScrollAway?: boolean;

    /**
     * The title to display in the navigation bar. It will be truncated based
     * on how much room is in the navigation bar.
     *
     * The title will not be displayed when scrolled to the top of the view.
     */
    readonly title?: ReactNode;

    /**
     * The title only displays once the user has scrolled past this element. When
     * crossing this boundary the title animates in/out.
     */
    readonly getTitleBoundaryElement?: Memo<() => HTMLElement>;

    /**
     * The title only displays once the user has scrolled this distance past the
     * title boundary element's top.
     */
    readonly titleBoundaryMarginTop?: Spacing | RemLength;

    /**
     * Don't let the title disappear when the navigation bar is scrolled to the
     * top. This can lead to some cleaner designs.
     */
    readonly withoutDisappearingTitle?: boolean;

    /**
     * A secondary title we render under the main title at a smaller size. Used to
     * add a bit of extra detail.
     */
    readonly subtitle?: ReactNode;

    /**
     * Actions that are made available to the user in a menu button at the right of
     * the navigation bar. These are secondary and tertiary actions where it
     * doesn't make sense to give them their own screen space.
     */
    readonly menuActions?: ReadonlyArray<MenuAction> | ReadonlyArray<ReadonlyArray<MenuAction>>;

    /**
     * Extra content to render at the bottom of the context menu. Useful for
     * displaying metadata like "Imported from..." text.
     */
    readonly contextMenuExtraBottom?: ReactNode;

    /**
     * Offset between the menu button and its menu. Defaults to
     * `defaultTooltipOffset` (same as every other `<MenuButton>`). Generally, you
     * shouldn't configure this so we maintain spacing consistency across the
     * product.
     *
     * An example of where we use this: the subscribe button in channels is bigger
     * than other buttons in the navigation bar and we want to move the menu
     * further away from it.
     */
    readonly menuOffset?: Spacing;

    /**
     * Actions that the user sees if they right click on the navigation bar.
     */
    readonly contextMenuActions?: ReadonlyArray<ReadonlyArray<MenuAction>>;

    /**
     * Configures the behavior of the share button in the navigation bar. If not
     * provided then there's no share button in the navigation bar.
     */
    readonly shareButton?: NavigationBarShareButtonProps;

    /**
     * Always use the share menu item for the `shareButton` UI. Even on wide layouts
     * that would normally put the share button directly in the navigation bar.
     */
    readonly withWideRouteLayoutShareMenuItem?: boolean;

    /**
     * If provided, completely replace the actions in this navigation bar's content
     * (which includes `menuActions` and `shareButton`) with the contents of this
     * node.
     *
     * Useful if you're entering an edit modality and need controls to exit the
     * editing modality.
     */
    readonly replaceActions?: ReactNode;

    /**
     * How do we justify title contents? Defaults to `center` on mobile and
     * `flex-start` on desktop. Override if you want the same behavior on both
     * platforms.
     */
    readonly titleJustifyContent?: "center" | "flex-start";

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
    readonly desktopControls?: ReactNode;

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
    readonly desktopMaxWidth?: Spacing | RemLength;

    /**
     * The amount of space the title can occupy on desktop. This also has the
     * effect of centering the title container (of this width) when set.
     */
    readonly desktopTitleMaxWidth?: Spacing | RemLength;

    /**
     * When using `desktopTitleMaxWidth` we offset the title from the center by
     * this much. Pushing the title to the left by half this value. It's used when
     * your content is optically centered (disregarding the space layout sidebar
     * width) to make sure the navigation bar title is optically centered as well.
     */
    readonly desktopTitleMaxWidthCenterOffset?: Spacing | RemLength;

    /**
     * Font size to use for the title on desktop.
     */
    readonly desktopTitleFontSize?: FontSize;

    /**
     * Font weight to use for the title on desktop.
     */
    readonly desktopTitleFontWeight?: "semi-bold" | "bold";

    /**
     * Slop we add to the left of the title element. You can use this if you don't
     * want the title's `overflow="hidden"` to clip some UI the title renders to
     * the left.
     */
    readonly desktopTitleLeftSlop?: Spacing;

    /**
     * Actions to render next to `shareButton` or `actions` on desktop.
     */
    readonly desktopAdditionalActions?: ReactNode;

    /**
     * Don't render a back button on mobile. Only set this to true for top level
     * mobile tab routes.
     */
    readonly withoutMobileBackButton?: boolean;

    /**
     * The cover of the document. If provided, it will be displayed in the
     * navigation bar. But it won't stick, it'll scroll with the content.
     */
    readonly contentCover?: ReactNode;

    /**
     * The default route to navigate to when the back button is pressed and there
     * is no previous page in browser history.
     */
    readonly defaultPreviousRoute?: MaybeThunk<string>;

    /**
     * By default, the navigation bar on mobile has a back button which calls
     * `navigate(-1)`. If you'd like to provide custom back navigation behavior
     * then you may pass this prop which will switch the back button to an "X"
     * close button that calls the function when pressed.
     *
     * For instance, if you use this in a `<MobileFullScreenModal>` you need to
     * close the modal instead of calling `navigate(-1)`.
     */
    readonly onMobileClose?: () => void;

    /**
     * By default, the navigation bar on mobile has a back button which calls
     * `navigate(-1)`. If you'd like to provide custom back navigation behavior
     * then you may pass this prop which will switch the back button to a "Cancel"
     * button that calls the function when pressed.
     *
     * For instance, if you use this in a `<MobileFullScreenModal>` you need to
     * close the modal instead of calling `navigate(-1)`.
     */
    readonly onMobileCancel?: () => void;
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
