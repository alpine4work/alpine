import {Box} from "~/client/web/design/box.js";
import {PrettyAbsoluteDate} from "~/client/web/design/pretty_absolute_date.js";
import {LogoMark} from "~/client/web/icons/brand/logo_mark.js";
import {useRouteLayout} from "~/client/web/remix/route_layout_context.js";
import {CreateWidgetSecondaryMenuBar} from "~/client/web/spaces/layout/create_widget_secondary_menu_bar.js";
import {
    postContentViewHeaderAvatarSize,
    postContentViewInnerMarginY,
    postContentViewOuterMarginY,
} from "~/client/web/styles/forum_shared_styles.js";
import {
    contentStyles,
    hiddenIfDarkColorSchemeClassName,
    hiddenIfLightColorSchemeClassName,
    sprinkles,
} from "~/client/web/styles/styles.js";
import {boldClassName, paragraphClassName} from "~/shared/design/core/constant_class_names.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {FeedWelcomeEntryModel} from "~/shared/feed/feed_entry_model.js";
import {noop} from "~/shared/helpers/control/noop.open_source.js";

export function FeedWelcomeEntryView({entry}: {entry: FeedWelcomeEntryModel}) {
    const routeLayout = useRouteLayout();

    return (
        <Box
            paddingTop={postContentViewOuterMarginY}
            style={{
                // In `<PostListView>` `bottomBorder` renders with `bottom: -1px` when
                // `routeLayout` isn't `narrow`. It's noticeable for this component because it
                // makes the space under the last `<CreateWidgetSecondaryMenuBar>` item appear
                // smaller than the space between other `<CreateWidgetSecondaryMenuBar>` items. So
                // fix this by adding 1px of bottom padding which the `bottomBorder` will be
                // rendered into making sure the space between items is consistent.
                paddingBottom: routeLayout === "narrow" ? 0 : 1,
            }}
        >
            <Box paddingX={screenPaddingX} display="flex" height={postContentViewHeaderAvatarSize}>
                <Box
                    className={hiddenIfLightColorSchemeClassName}
                    overflow="hidden"
                    flexShrink="0"
                    borderRadius="full"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    color="grey-80-const"
                    position="relative"
                    zIndex="0"
                    width={postContentViewHeaderAvatarSize}
                    height={postContentViewHeaderAvatarSize}
                    backgroundColor="grey-0-const"
                    style={{padding: "0.4375rem", paddingBottom: "0.5rem"}}
                >
                    <LogoMark color="grey-100-const" />
                </Box>
                <Box
                    className={hiddenIfDarkColorSchemeClassName}
                    overflow="hidden"
                    flexShrink="0"
                    display="flex"
                    justifyContent="center"
                    alignItems="center"
                    color="grey-80-const"
                    position="relative"
                    zIndex="0"
                    width={postContentViewHeaderAvatarSize}
                    height={postContentViewHeaderAvatarSize}
                >
                    <LogoMark color="grey-100-const" size="6" />
                </Box>
                <Box paddingLeft={{mobile: "2", desktop: "3"}} overflow="hidden">
                    <Box fontSize="75" fontStyle="truncate" color="grey-70">
                        <span className={sprinkles({color: "grey-100", fontStyle: "semi-bold"})}>
                            Alpine
                        </span>
                    </Box>
                    <Box fontSize="50" fontStyle="truncate" color="grey-50">
                        <PrettyAbsoluteDate tooltipPlacement="bottom" date={entry.addedTime} />
                    </Box>
                </Box>
            </Box>
            <Box
                className={contentStyles.docClassName}
                paddingX={screenPaddingX}
                fontSize="100"
                paddingTop={postContentViewInnerMarginY}
                paddingBottom="4"
                userSelect="text"
            >
                <Box className={paragraphClassName}>
                    Welcome to Alpine. This is your &#x201C;for you&#x201D; feed, anything you or
                    others create will go here.
                    {entry.emailDomainWithAutoAddAccountsEnabled && (
                        <>
                            {" "}
                            Everyone with{" "}
                            {/^[aeiou]/i.test(entry.emailDomainWithAutoAddAccountsEnabled)
                                ? "an"
                                : "a"}{" "}
                            <strong className={boldClassName}>
                                @{entry.emailDomainWithAutoAddAccountsEnabled}
                            </strong>{" "}
                            email address will be added to this space with you.
                        </>
                    )}{" "}
                    Get started by creating a document or project.
                </Box>
            </Box>
            <CreateWidgetSecondaryMenuBar
                headingType="Null"
                withCreateVerbBeforeItemName={true}
                withRootNavigateToCreatedDocument={true}
                withDocumentAndProjectTaskStartHereBadges={true}
                onCloseWithAnimation={noop}
                onCloseWithoutAnimation={noop}
                onFocusPrimaryMenuBar={noop}
            />
        </Box>
    );
}
