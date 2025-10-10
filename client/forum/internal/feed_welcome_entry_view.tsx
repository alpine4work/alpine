import {useSearchParams} from "@remix-run/react";
import classNames from "classnames";
import {Bell, MagnifyingGlass, Users} from "phosphor-react";
import {useRef} from "react";
import {accountAvatarClassName} from "~/client/accounts/account_avatar_html.js";
import {useAccountModel} from "~/client/accounts/account_registry_context.js";
import {Box} from "~/client/design/box.js";
import {PrettyAbsoluteDate} from "~/client/design/pretty_absolute_date.js";
import {LogoMark} from "~/client/icons/brand/logo_mark.js";
import {TaskBrandIcon} from "~/client/icons/brand/task_brand_icon.js";
import {usePlatform} from "~/client/remix/platform_context.js";
import {useNavigate} from "~/client/remix/use_navigate.js";
import {useSpaceContextAndRequireSpaceAccess} from "~/client/spaces/space_context.js";
import {
    postContentViewHeaderAvatarSize,
    postContentViewInnerMarginY,
    postContentViewOuterMarginY,
} from "~/client/styles/forum_shared_styles.js";
import {sprinkles} from "~/client/styles/styles.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {
    listItemClassName,
    paragraphClassName,
    unorderedListItemClassName,
} from "~/shared/design/core/constant_class_names.js";
import {screenPaddingX} from "~/shared/design/core/spacing.js";
import {FeedWelcomeEntryModel} from "~/shared/feed/feed_entry_model.js";
import {assertExists} from "~/shared/helpers/control/assert_exists.js";
import {hasSpaceRole} from "~/shared/spaces/space_model.js";

const welcomeTextOptions = [
    "Hey {name}, welcome to Alpine! Your work is all here - tasks, documents, messages, and more.",
    "Welcome {name}! Alpine brings together everything you need to collaborate and get things done.",
    "Hi {name}! You’re all set up in Alpine - your central hub for tasks, docs, and team communication.",
    "Great to see you here, {name}! Alpine keeps all your work organized in one place.",
    "Welcome aboard, {name}! Alpine is your workspace for seamless collaboration and productivity.",
];

function getWelcomeText(spaceId: string, accountName: string): string {
    const lastChar = spaceId.charCodeAt(spaceId.length - 1);
    const selectedIndex = lastChar % welcomeTextOptions.length;
    return assertExists(welcomeTextOptions[selectedIndex]).replace("{name}", accountName);
}

/**
 * Recreates the styles of a SearchEntity mention in a bulleted list.
 */
function BulletedMention({
    title,
    icon,
    onClick,
}: {
    title: string;
    icon: React.ReactNode;
    onClick: () => void;
}) {
    return (
        <Box
            className={classNames(listItemClassName, unorderedListItemClassName)}
            style={{"--content_listItemIndentation": 0} as React.CSSProperties}
            data-list-indent="0"
            onClick={onClick}
        >
            <Box
                className={paragraphClassName}
                display="flex"
                flexDirection="row"
                alignItems="center"
                gap="1"
                fontStyle="bold"
                cursor="pointer"
            >
                {icon}
                {title}
            </Box>
        </Box>
    );
}

export function FeedWelcomeEntryView({entry}: {entry: FeedWelcomeEntryModel}) {
    const {currentAccount, space} = useSpaceContextAndRequireSpaceAccess();
    const currentAccountData = useAccountModel(currentAccount);
    const navigate = useNavigate();
    const platform = usePlatform();
    const hasAdminAccess = hasSpaceRole(currentAccountData.space.role, "Admin");
    const ref = useRef<HTMLDivElement>(null);
    const welcomeText = getWelcomeText(
        space.id,
        getAccountShortNameWithoutFullNameTooltip(currentAccountData),
    );

    const [searchParams, setSearchParams] = useSearchParams();

    return (
        <Box paddingX={screenPaddingX} paddingY={postContentViewOuterMarginY}>
            <Box display="flex" height={postContentViewHeaderAvatarSize}>
                <Box
                    className={accountAvatarClassName}
                    backgroundColor="grey-100"
                    width={postContentViewHeaderAvatarSize}
                    height={postContentViewHeaderAvatarSize}
                    padding="1.5"
                    paddingBottom="2"
                    overflow="hidden"
                >
                    <LogoMark color="grey-0" />
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
            <Box fontSize="100" paddingY={postContentViewInnerMarginY} ref={ref}>
                <Box className={paragraphClassName} userSelect="text">
                    {welcomeText}
                </Box>
                <Box className={paragraphClassName} userSelect="text">
                    This is your “For you” page, where you can see all that’s happening within{" "}
                    {space.name}.
                </Box>
                <Box className={paragraphClassName}>
                    <Box userSelect="text">Here are some quick links to get you started:</Box>
                    <BulletedMention
                        title="My tasks"
                        icon={<TaskBrandIcon />}
                        onClick={() => {
                            navigate(`/s/${space.id}/tasks`);
                        }}
                    />
                    <BulletedMention
                        title="Search"
                        icon={<MagnifyingGlass />}
                        onClick={() => {
                            if (platform === "mobile") {
                                navigate(`/s/${space.id}/search`);
                            } else {
                                const newSearchParams = new URLSearchParams(searchParams);
                                newSearchParams.set("search", "");
                                setSearchParams(newSearchParams);
                            }
                        }}
                    />
                    <BulletedMention
                        title="Inbox"
                        icon={<Bell />}
                        onClick={() => {
                            // Just go to full screen inbox. We don't have an easy way to tie into
                            // the space_layout_side_bar_inbox_button.tsx component yet.
                            navigate(`/s/${space.id}/inbox`);
                        }}
                    />
                    {hasAdminAccess && (
                        <BulletedMention
                            title="Add people"
                            icon={<Users />}
                            onClick={() => {
                                navigate(`/s/${space.id}/settings/people`);
                            }}
                        />
                    )}
                </Box>
            </Box>
        </Box>
    );
}
