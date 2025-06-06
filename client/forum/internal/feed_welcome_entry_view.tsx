import {accountAvatarClassName} from "~/client/accounts/account_avatar_html.js";
import {Box} from "~/client/design/box.js";
import {PrettyAbsoluteDate} from "~/client/design/pretty_absolute_date.js";
import {
    feedEntryHeight,
    postContentViewHeaderAvatarSize,
    postContentViewInnerMarginY,
    postContentViewOuterMarginY,
} from "~/client/styles/forum_shared_styles.js";
import {sprinkles} from "~/client/styles/styles.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {FeedWelcomeEntryModel} from "~/shared/feed/feed_entry_model.js";

export function FeedWelcomeEntryView({entry}: {entry: FeedWelcomeEntryModel}) {
    return (
        <Box
            paddingX={screenPaddingX}
            paddingY={postContentViewOuterMarginY}
            style={{height: feedEntryHeight}}
        >
            <Box display="flex" height={postContentViewHeaderAvatarSize}>
                <Box
                    // TODO(calebmer): Alpine logo!
                    className={accountAvatarClassName}
                    backgroundColor="grey-30-const"
                    width={postContentViewHeaderAvatarSize}
                    height={postContentViewHeaderAvatarSize}
                />
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
                fontSize="100"
                paddingY={postContentViewInnerMarginY}
                userSelect="text"
                // TODO(calebmer): Actual onboarding content
            >
                Welcome to Alpine! Eventually we’ll have some onboarding information for you here at
                the beginning of your “For you” feed. Thanks for being an alpha user! We appreciate
                you.
            </Box>
        </Box>
    );
}
