import {CalendarDate} from "@internationalized/date";
import {Fragment, ReactNode, useRef} from "react";
import {usePress} from "react-aria";
import {useAccountModel} from "~/client/web/accounts/account_registry_context.js";
import {Box} from "~/client/web/design/box.js";
import {FocusRing} from "~/client/web/design/focus_ring.js";
import {PrettyAbsoluteDateTooltipContent} from "~/client/web/design/pretty_absolute_date.js";
import {PrettyConjunctionList} from "~/client/web/design/pretty_conjunction_list.js";
import {Tooltip} from "~/client/web/design/tooltip.js";
import {useClientInfo} from "~/client/web/remix/client_info_context.js";
import {
    useCurrentDate,
    useCurrentTimeRoundedToNearestTenMinutes,
} from "~/client/web/remix/use_current_time_rounded_to_hour.js";
import {useNavigate} from "~/client/web/remix/use_navigate.js";
import {useSpaceContext} from "~/client/web/spaces/context/space_context.js";
import {TaskActivityFeedItem} from "~/client/web/tasks/internal/derive_task_activity_feed.js";
import {getTaskActivityFeedItemTextSegments} from "~/client/web/tasks/internal/get_task_activity_feed_item_text_segments.js";
import {getAccountShortNameWithoutFullNameTooltip} from "~/shared/accounts/get_account_short_name_without_full_name_tooltip.js";
import {formatCompactRelativeDateWithoutFullTimeTooltip} from "~/shared/design/format_compact_relative_date_without_full_time_tooltip.js";
import {Locale} from "~/shared/helpers/intl/locale.open_source.js";
import {TimeZone} from "~/shared/helpers/intl/time_zone.open_source.js";
import {AccountId} from "~/shared/id/types/id_types.open_source.js";
import {AccountModel} from "~/shared/spaces/account_model.js";
import {TaskActivityActor} from "~/shared/tasks/task_activity.js";

/**
 * One run of consecutive activity feed items rendered between comments in the task
 * detail view. Rows are deliberately quieter than comments: actors read as part of
 * the sentence with no extra emphasis, and a compact trailing relative date ("2d")
 * carries the full time in its tooltip. The date, the separating dot, and the
 * sentence share a color so the timestamp doesn't read as a lighter afterthought.
 *
 * Rows are centered and share the font size and color of the message timestamp
 * dividers (see `<MessageView>`) so activity reads as the same class of ambient
 * chrome between comments rather than as content.
 */
export function TaskActivityFeedRunView({
    feedItems,
    taskNoun,
}: {
    feedItems: ReadonlyArray<TaskActivityFeedItem>;
    /**
     * What to call the thing this activity is about (a project is a task layout).
     */
    taskNoun: "task" | "project";
}) {
    // Read the clocks once here rather than per item — every row would otherwise mount
    // its own identical subscriptions, and a task can render dozens of rows.
    const {timeZone, locale} = useClientInfo();
    const {currentAccount} = useSpaceContext();
    const currentTime = useCurrentTimeRoundedToNearestTenMinutes();
    const currentDate = useCurrentDate();

    return (
        <Box display="flex" flexDirection="column" gap="1" paddingY="2">
            {feedItems.map(feedItem => (
                <TaskActivityFeedItemView
                    key={feedItem.feedItemId}
                    feedItem={feedItem}
                    timeZone={timeZone}
                    locale={locale}
                    currentTime={currentTime}
                    currentDate={currentDate}
                    currentAccountId={currentAccount?.id ?? null}
                    taskNoun={taskNoun}
                />
            ))}
        </Box>
    );
}

function TaskActivityFeedItemView({
    feedItem,
    timeZone,
    locale,
    currentTime,
    currentDate,
    currentAccountId,
    taskNoun,
}: {
    feedItem: TaskActivityFeedItem;
    timeZone: TimeZone;
    locale: Locale;
    currentTime: Date;
    currentDate: CalendarDate;
    currentAccountId: AccountId | null;
    taskNoun: "task" | "project";
}) {
    const segments = getTaskActivityFeedItemTextSegments(feedItem, {
        timeZone,
        locale,
        currentDate,
        currentAccountId,
        taskNoun,
    });

    const getActorElement = (actor: TaskActivityActor | null) => {
        return actor === null ? "Alpine" : <TaskActivityFeedAccountName account={actor.account} />;
    };

    let actorFragments: ReactNode;

    if (feedItem.type === "NotesWindow" || feedItem.type === "TitleWindow") {
        // Storage caps the actors a window carries; `totalActorCount` carries the real
        // contributor count so the overflow renders as "and N others".
        const overflowActorCount = feedItem.totalActorCount - feedItem.actors.length;
        actorFragments = (
            <PrettyConjunctionList
                list={[
                    ...feedItem.actors.map((actor, actorIndex) => (
                        <Fragment key={actorIndex}>{getActorElement(actor)}</Fragment>
                    )),
                    ...(overflowActorCount > 0
                        ? [`${overflowActorCount} ${overflowActorCount === 1 ? "other" : "others"}`]
                        : []),
                ]}
            />
        );
    } else {
        actorFragments = getActorElement(feedItem.actor);
    }

    return (
        <Box fontSize="50" color="grey-50" textAlign="center">
            {actorFragments}{" "}
            {segments.map((segment, segmentIndex) =>
                segment.type === "Account" ? (
                    <TaskActivityFeedAccountName key={segmentIndex} account={segment.account} />
                ) : (
                    <Fragment key={segmentIndex}>{segment.text}</Fragment>
                ),
            )}
            <Tooltip content={<PrettyAbsoluteDateTooltipContent date={feedItem.feedItemTime} />}>
                <span>
                    {` · ${formatCompactRelativeDateWithoutFullTimeTooltip(
                        currentTime,
                        feedItem.feedItemTime,
                    )}`}
                </span>
            </Tooltip>
        </Box>
    );
}

function TaskActivityFeedAccountName({account}: {account: AccountModel}) {
    const {space, currentAccount} = useSpaceContext();

    // Read through the account registry so a name stays consistent with every other
    // place the account is rendered, and updates when it changes.
    const accountData = useAccountModel(account);

    if (account.id === currentAccount?.id) return <span>You</span>;

    if (accountData === null) return <>Someone</>;

    const accountName = (
        <Tooltip content={accountData.name}>
            <span>{getAccountShortNameWithoutFullNameTooltip(accountData)}</span>
        </Tooltip>
    );

    // URL-grant viewers can read the activity without having an account in the space,
    // and removed accounts are no longer valid chat targets. Keep their names inert.
    if (currentAccount === null || accountData.space.state.type === "Removed") return accountName;

    return (
        <TaskActivityFeedAccountNameButton url={`/chat/with/${accountData.id}/${space.id}?focus`}>
            {accountName}
        </TaskActivityFeedAccountNameButton>
    );
}

/**
 * Opens a chat with the account. The pointer cursor and a subtle press state are
 * the only affordances on purpose: the sentence should read naturally, not like a
 * row of links.
 *
 * Built from `<Box>` rather than `<Link>` because `<Link>` doesn't go through
 * `navigate()`.
 */
function TaskActivityFeedAccountNameButton({url, children}: {url: string; children: ReactNode}) {
    const navigate = useNavigate();

    // A double click fires two presses. `navigate()` is async, so without this guard
    // the second press would run before the first settled and push a duplicate history
    // entry.
    const isNavigatingRef = useRef(false);

    const {pressProps, isPressed} = usePress({
        onPress: () => {
            if (isNavigatingRef.current) return;
            isNavigatingRef.current = true;

            navigate(url).finally(() => {
                isNavigatingRef.current = false;
            });
        },
    });

    return (
        <FocusRing>
            <Box
                {...pressProps}
                as="span"
                role="link"
                tabIndex={0}
                cursor="pointer"
                opacity={isPressed ? "50" : undefined}
                data-testid="TaskActivityFeedAccountNameButton"
            >
                {children}
            </Box>
        </FocusRing>
    );
}
