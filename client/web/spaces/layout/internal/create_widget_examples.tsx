import classNames from "classnames";
import {BellRinging, CalendarBlank, SortAscending} from "phosphor-react";
import {ReactNode, useState} from "react";
import {AccountAvatar} from "~/client/web/accounts/account_avatar.js";
import {Box} from "~/client/web/design/box.js";
import {Spacer} from "~/client/web/design/spacer.js";
import {TaskDisplayStatusCircle} from "~/client/web/design/task_display_status_circle.js";
import {useSpacingScale} from "~/client/web/remix/spacing_scale_context.js";
import {CreateWidgetExampleContent} from "~/client/web/spaces/layout/internal/create_widget_example_content.js";
import {
    postContentViewHeaderAvatarSize,
    postContentViewHeaderDesktopPostMetadataPaddingLeft,
    postContentViewHeaderHeight,
    postContentViewInnerMarginY,
} from "~/client/web/styles/forum_shared_styles.js";
import {
    messageViewAccountAvatarSize,
    messageViewAccountNameFontSize,
    messageViewAccountNameHeight,
    messageViewAvatarOffsetYPx,
    messageViewRailGap,
} from "~/client/web/styles/messaging_shared_styles.js";
import {contentStyles, forumStyles} from "~/client/web/styles/styles.js";
import {
    taskDetailViewDenseFieldMinHeight,
    taskDetailViewFieldLabelFontSize,
    taskQueryFilterEditorDesktopHeight,
    taskRowViewMinHeight,
} from "~/client/web/styles/tasks_shared_styles.js";
import {TaskChildTasksProgressWheel} from "~/client/web/tasks/task_child_tasks_progress_wheel.js";
import {TaskPriorityIcon} from "~/client/web/tasks/task_priority_icon.js";
import {
    headingLevel1ClassName,
    paragraphClassName,
} from "~/shared/design/core/constant_class_names.js";
import {
    RemLength,
    addRemLengths,
    parseRemLength,
    spacing,
    subtractRemLengths,
} from "~/shared/design/core/spacing.js";
import {generateId} from "~/shared/id/id.js";
import {AccountId} from "~/shared/id/types/id_types.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";

export const createWidgetExampleHeight = "20";

const createWidgetExampleDefaultScale = 0.6;
const createWidgetExampleDocumentScale = 0.5;

const createWidgetExampleDefaultPadding = "3";
const createWidgetExampleDefaultPaddingAtDefaultScale: RemLength = `${parseRemLength(createWidgetExampleDefaultPadding) / createWidgetExampleDefaultScale}rem`;

const createWidgetExampleThickPadding: RemLength = `${parseRemLength(createWidgetExampleDefaultPadding) * 1.5}rem`;
const createWidgetExampleThickPaddingAtDefaultScale: RemLength = `${parseRemLength(createWidgetExampleThickPadding) / createWidgetExampleDefaultScale}rem`;
const createWidgetExampleThickPaddingAtDocumentScale: RemLength = `${parseRemLength(createWidgetExampleThickPadding) / createWidgetExampleDocumentScale}rem`;

export function CreateWidgetDocumentExample({content}: {content: CreateWidgetExampleContent}) {
    return (
        <Box
            style={{
                transformOrigin: "top left",
                transform: `scale(${createWidgetExampleDocumentScale})`,
                width: `${(1 / createWidgetExampleDocumentScale) * 100}%`,
            }}
        >
            <Box
                className={classNames(
                    contentStyles.docClassName,
                    contentStyles.withUserSelectNoneDocClassName,
                    contentStyles.narrowRouteLayoutDocClassName,
                )}
                padding="9"
                style={{padding: createWidgetExampleThickPaddingAtDocumentScale}}
            >
                <Box className={headingLevel1ClassName} style={{whiteSpace: "nowrap"}}>
                    {content.document.title}
                </Box>
                <Box as="p" className={paragraphClassName}>
                    {content.document.paragraph1}
                </Box>
                <Box as="p" className={paragraphClassName}>
                    {content.document.paragraph2}
                </Box>
            </Box>
        </Box>
    );
}

export function CreateWidgetTaskExample({content}: {content: CreateWidgetExampleContent}) {
    const [mockAccountId] = useState(() => generateId<AccountId>());

    return (
        <Box
            style={{
                transformOrigin: "top left",
                transform: `scale(${createWidgetExampleDefaultScale})`,
                width: `${(1 / createWidgetExampleDefaultScale) * 100}%`,
            }}
        >
            <Box style={{padding: createWidgetExampleDefaultPaddingAtDefaultScale}}>
                <Box display="flex" alignItems="center" gap="3">
                    <TaskDisplayStatusCircle displayStatus="OpenInactive" size="6" />
                    <Box fontSize="200" fontStyle="semi-bold" style={{whiteSpace: "nowrap"}}>
                        {content.task.title}
                    </Box>
                </Box>
                <Box style={{height: createWidgetExampleDefaultPaddingAtDefaultScale}} />
                <Box
                    display="grid"
                    gap="3"
                    style={{
                        gridTemplateColumns: "auto minmax(0, 1fr)",
                        gridTemplateRows: "repeat(auto-fill, auto)",
                        gridAutoFlow: "row dense",
                    }}
                >
                    <CreateWidgetTaskExampleDenseField name="Assignee">
                        <Box marginY="-0.5" display="flex" alignItems="center" gap="1.5">
                            <AccountAvatar
                                size="5"
                                account={{
                                    id: mockAccountId,
                                    reactionCharacter: null,
                                    avatar: {content: content.task.assignee.avatarContent},
                                    space: {state: {type: "Active"}},
                                }}
                            />
                            <Box>{content.task.assignee.name}</Box>
                        </Box>
                    </CreateWidgetTaskExampleDenseField>
                    <CreateWidgetTaskExampleDenseField name="Due date">
                        <Box display="flex" alignItems="center" gap="1">
                            <CalendarBlank size={spacing["4"]} />
                            <Box>May 4</Box>
                        </Box>
                    </CreateWidgetTaskExampleDenseField>
                    <CreateWidgetTaskExampleDenseField name="Priority">
                        <Box display="flex" alignItems="center" gap="1">
                            <TaskPriorityIcon
                                size="4"
                                priority="Medium"
                                shouldHighlightUrgent={false}
                            />
                            <Box>Medium</Box>
                        </Box>
                    </CreateWidgetTaskExampleDenseField>
                    <CreateWidgetTaskExampleDenseField
                        // This shouldn't actually render in the preview, it should be offscreen. But we
                        // need the name "Collections" to establish the correct dense field label width (in
                        // our `display: grid` container) as "Collections" is the longest name.
                        name="Collections"
                    />
                </Box>
            </Box>
        </Box>
    );
}

function CreateWidgetTaskExampleDenseField({name, children}: {name: string; children?: ReactNode}) {
    return (
        <>
            <Box display="block" maxWidth="24" minHeight={taskDetailViewDenseFieldMinHeight}>
                <Box
                    fontSize={taskDetailViewFieldLabelFontSize}
                    fontStyle="truncate"
                    color="grey-60"
                >
                    {name}
                </Box>
            </Box>
            <Box minHeight={taskDetailViewDenseFieldMinHeight}>{children}</Box>
        </>
    );
}

export function CreateWidgetProjectTaskExample({content}: {content: CreateWidgetExampleContent}) {
    return (
        <Box
            style={{
                transformOrigin: "top left",
                transform: `scale(${createWidgetExampleDefaultScale})`,
                width: `${(1 / createWidgetExampleDefaultScale) * 100}%`,
            }}
        >
            <Box
                position="relative"
                style={{padding: createWidgetExampleDefaultPaddingAtDefaultScale}}
            >
                <Box display="flex" alignItems="center">
                    <TaskDisplayStatusCircle displayStatus="OpenActive" size="6" />
                    <Spacer space="3" />
                    <Box fontSize="200" fontStyle="semi-bold" style={{whiteSpace: "nowrap"}}>
                        {content.projectTask.title}
                    </Box>
                    <Spacer space="2" />
                    <Box display="flex" alignItems="center" gap="1">
                        <TaskChildTasksProgressWheel childTaskCount={12} closedChildTaskCount={7} />
                        <Box color="grey-70">7/12</Box>
                    </Box>
                </Box>
                <Box
                    position="absolute"
                    bottom="0"
                    height="border"
                    backgroundColor="grey-5"
                    style={{
                        left: createWidgetExampleDefaultPaddingAtDefaultScale,
                        right: createWidgetExampleDefaultPaddingAtDefaultScale,
                    }}
                />
            </Box>
            <CreateWidgetProjectExampleTaskRow title={content.task.title} />
            <CreateWidgetProjectExampleTaskRow title={content.projectTask.otherChildTaskTitle} />
        </Box>
    );
}

export function CreateWidgetTaskCollectionExample({
    content,
}: {
    content: CreateWidgetExampleContent;
}) {
    return (
        <Box
            style={{
                transformOrigin: "top left",
                transform: `scale(${createWidgetExampleDefaultScale})`,
                width: `${(1 / createWidgetExampleDefaultScale) * 100}%`,
            }}
        >
            <Box
                position="relative"
                style={{padding: createWidgetExampleDefaultPaddingAtDefaultScale}}
            >
                <Box display="flex" alignItems="center" gap="2">
                    <Box
                        width="2"
                        height="2"
                        borderRadius="full"
                        backgroundColor={`${content.taskCollection.color}-50`}
                    />
                    <Box fontSize="200" fontStyle="semi-bold" style={{whiteSpace: "nowrap"}}>
                        {content.taskCollection.name}
                    </Box>
                </Box>
                <Box
                    position="absolute"
                    bottom="0"
                    height="border"
                    backgroundColor="grey-5"
                    style={{
                        left: createWidgetExampleDefaultPaddingAtDefaultScale,
                        right: createWidgetExampleDefaultPaddingAtDefaultScale,
                    }}
                />
            </Box>
            <CreateWidgetProjectExampleTaskRow title={content.projectTask.title} />
            <CreateWidgetProjectExampleTaskRow title={content.task.title} />
        </Box>
    );
}

export function CreateWidgetTaskQueryExample({content}: {content: CreateWidgetExampleContent}) {
    return (
        <Box
            style={{
                transformOrigin: "top left",
                transform: `scale(${createWidgetExampleDefaultScale})`,
                width: `${(1 / createWidgetExampleDefaultScale) * 100}%`,
            }}
        >
            <Box
                position="relative"
                style={{padding: createWidgetExampleDefaultPaddingAtDefaultScale}}
            >
                <Box display="flex" alignItems="center" justifyContent="space-between">
                    <Box display="flex" alignItems="center">
                        <Box paddingRight="2">Filter:</Box>
                        <Box
                            height={taskQueryFilterEditorDesktopHeight}
                            display="flex"
                            alignItems="center"
                            borderRadius="1"
                            border="grey-10"
                        >
                            <Box paddingLeft="2" paddingRight="1">
                                Priority
                            </Box>
                            <Box minWidth="4" paddingX="1" color="grey-60">
                                is
                            </Box>
                            <Box
                                paddingLeft="1"
                                paddingRight="2"
                                display="flex"
                                alignItems="center"
                            >
                                <TaskPriorityIcon
                                    priority="High"
                                    size="3"
                                    shouldHighlightUrgent={false}
                                />
                                <Box paddingLeft="1">high</Box>
                            </Box>
                        </Box>
                    </Box>
                    <Box display="flex" alignItems="center" gap="1">
                        <SortAscending size={spacing["3"]} />
                        <Box>Sort</Box>
                    </Box>
                </Box>
                <Box
                    position="absolute"
                    bottom="0"
                    height="border"
                    backgroundColor="grey-5"
                    style={{
                        left: createWidgetExampleDefaultPaddingAtDefaultScale,
                        right: createWidgetExampleDefaultPaddingAtDefaultScale,
                    }}
                />
            </Box>
            <CreateWidgetProjectExampleTaskRow title={content.taskQuery.taskTitle1} />
            <CreateWidgetProjectExampleTaskRow title={content.taskQuery.taskTitle2} />
        </Box>
    );
}

function CreateWidgetProjectExampleTaskRow({
    title,
    displayStatus = "OpenInactive",
}: {
    title: string;
    displayStatus?: TaskDisplayStatus;
}) {
    return (
        <Box
            position="relative"
            display="flex"
            alignItems="center"
            gap="2"
            style={{
                paddingLeft: createWidgetExampleDefaultPaddingAtDefaultScale,
                paddingRight: createWidgetExampleDefaultPaddingAtDefaultScale,
                // Subtracting a bit of height produces a slightly more aesthetic truncation at the
                // end of the example preview.
                height: subtractRemLengths(taskRowViewMinHeight, "0.5"),
            }}
        >
            <TaskDisplayStatusCircle displayStatus={displayStatus} size="4" />
            <Box fontSize="100" style={{whiteSpace: "nowrap"}}>
                {title}
            </Box>
            <Box
                position="absolute"
                height="border"
                backgroundColor="grey-5"
                style={{
                    bottom: -1,
                    left: createWidgetExampleDefaultPaddingAtDefaultScale,
                    right: createWidgetExampleDefaultPaddingAtDefaultScale,
                }}
            />
        </Box>
    );
}

export function CreateWidgetPostExample({content}: {content: CreateWidgetExampleContent}) {
    return (
        <Box
            style={{
                transformOrigin: "top left",
                transform: `scale(${createWidgetExampleDefaultScale})`,
                width: `${(1 / createWidgetExampleDefaultScale) * 100}%`,
            }}
        >
            <Box
                position="relative"
                style={{padding: createWidgetExampleThickPaddingAtDefaultScale}}
            >
                <CreateWidgetPostExampleContent content={content} withChannel={true} />
            </Box>
        </Box>
    );
}

function CreateWidgetPostExampleContent({
    content,
    withChannel,
}: {
    content: CreateWidgetExampleContent;
    withChannel: boolean;
}) {
    const [mockAccountId] = useState(() => generateId<AccountId>());

    return (
        <Box>
            <Box height={postContentViewHeaderHeight} display="flex" alignItems="center">
                <AccountAvatar
                    size={postContentViewHeaderAvatarSize}
                    account={{
                        id: mockAccountId,
                        reactionCharacter: null,
                        avatar: {content: content.post.author.avatarContent},
                        space: {state: {type: "Active"}},
                    }}
                />
                <Box paddingLeft={postContentViewHeaderDesktopPostMetadataPaddingLeft}>
                    <Box className={forumStyles.postHeaderAuthorAndChannelClassName}>
                        <Box as="span" className={forumStyles.postHeaderAuthorClassName}>
                            {content.post.author.name}
                        </Box>
                        {withChannel && (
                            <>
                                {" "}
                                in{" "}
                                <Box as="span" color="grey-100" fontStyle="semi-bold">
                                    {content.channel.name}
                                </Box>
                            </>
                        )}
                    </Box>
                    <Box className={forumStyles.postHeaderCreatedTimeClassName}>
                        May 2nd at 4:25pm
                    </Box>
                </Box>
            </Box>
            <Spacer space={postContentViewInnerMarginY} />
            <Box
                className={classNames(
                    contentStyles.docClassName,
                    contentStyles.withUserSelectNoneDocClassName,
                    contentStyles.narrowRouteLayoutDocClassName,
                )}
            >
                <Box as="p" className={paragraphClassName}>
                    {content.post.paragraph}
                </Box>
            </Box>
        </Box>
    );
}

export function CreateWidgetChannelExample({content}: {content: CreateWidgetExampleContent}) {
    const paddingY = addRemLengths("3", "0.5");

    return (
        <Box
            style={{
                transformOrigin: "top left",
                transform: `scale(${createWidgetExampleDefaultScale})`,
                width: `${(1 / createWidgetExampleDefaultScale) * 100}%`,
            }}
        >
            <Box
                display="flex"
                alignItems="center"
                justifyContent="space-between"
                position="relative"
                style={{
                    paddingTop: paddingY,
                    paddingBottom: paddingY,
                    paddingLeft: createWidgetExampleDefaultPaddingAtDefaultScale,
                    paddingRight: paddingY,
                }}
            >
                <Box fontSize="300" fontStyle="semi-bold">
                    {content.channel.name}
                </Box>
                <Box
                    backgroundColor="grey-5"
                    color="grey-40"
                    height="7"
                    paddingX="2.5"
                    display="flex"
                    alignItems="center"
                    gap="1"
                    borderRadius="1"
                >
                    <BellRinging size={spacing["3"]} />
                    <Box>Subscribed</Box>
                </Box>
                <Box
                    position="absolute"
                    bottom="0"
                    left="0"
                    right="0"
                    height="border"
                    backgroundColor="grey-5"
                />
            </Box>
            <Box style={{padding: createWidgetExampleDefaultPaddingAtDefaultScale}}>
                <Box
                    style={{
                        transformOrigin: "top left",
                        transform: `scale(${createWidgetExampleDocumentScale / createWidgetExampleDefaultScale})`,
                        width: `${(1 / (createWidgetExampleDocumentScale / createWidgetExampleDefaultScale)) * 100}%`,
                    }}
                >
                    <CreateWidgetPostExampleContent content={content} withChannel={false} />
                </Box>
            </Box>
        </Box>
    );
}

export function CreateWidgetChatMessageExample({content}: {content: CreateWidgetExampleContent}) {
    return (
        <Box
            style={{
                transformOrigin: "top left",
                transform: `scale(${createWidgetExampleDefaultScale})`,
                width: `${(1 / createWidgetExampleDefaultScale) * 100}%`,
                height: `${parseRemLength(createWidgetExampleHeight) * (1 / createWidgetExampleDefaultScale)}rem`,
            }}
        >
            <Box
                position="relative"
                display="flex"
                alignItems="center"
                height="full"
                style={{
                    paddingLeft: createWidgetExampleThickPaddingAtDefaultScale,
                    paddingRight: createWidgetExampleThickPaddingAtDefaultScale,
                }}
            >
                <CreateWidgetChatMessageExampleContent content={content} />
            </Box>
        </Box>
    );
}

function CreateWidgetChatMessageExampleContent({content}: {content: CreateWidgetExampleContent}) {
    const spacingScale = useSpacingScale();

    const [mockAccountId] = useState(() => generateId<AccountId>());

    return (
        <Box display="flex" gap={messageViewRailGap} paddingRight="4">
            <Box flexShrink="0" width={messageViewAccountAvatarSize}>
                <Box position="relative" style={{top: messageViewAvatarOffsetYPx[spacingScale]}}>
                    <AccountAvatar
                        size={messageViewAccountAvatarSize}
                        account={{
                            id: mockAccountId,
                            reactionCharacter: null,
                            avatar: {content: content.chatMessage.author.avatarContent},
                            space: {state: {type: "Active"}},
                        }}
                    />
                </Box>
            </Box>
            <Box flexGrow="1" minWidth="flex-fit">
                <Box
                    fontSize={messageViewAccountNameFontSize}
                    color="grey-60"
                    style={{lineHeight: spacing[messageViewAccountNameHeight]}}
                >
                    {content.chatMessage.author.name}
                </Box>
                <Box
                    className={classNames(
                        contentStyles.docClassName,
                        contentStyles.messageDocClassName,
                        contentStyles.withUserSelectNoneDocClassName,
                        contentStyles.narrowRouteLayoutDocClassName,
                    )}
                >
                    <Box as="p" className={paragraphClassName}>
                        {content.chatMessage.paragraph}
                    </Box>
                </Box>
            </Box>
        </Box>
    );
}

export function CreateWidgetRoomChatExample({content}: {content: CreateWidgetExampleContent}) {
    return (
        <Box
            style={{
                transformOrigin: "top left",
                transform: `scale(${createWidgetExampleDefaultScale})`,
                width: `${(1 / createWidgetExampleDefaultScale) * 100}%`,
            }}
        >
            <Box
                position="relative"
                style={{
                    paddingTop: addRemLengths("3", "0.5"),
                    paddingBottom: addRemLengths("3", "0.5"),
                    paddingLeft: createWidgetExampleDefaultPaddingAtDefaultScale,
                    paddingRight: createWidgetExampleDefaultPaddingAtDefaultScale,
                }}
            >
                <Box fontSize="300" fontStyle="semi-bold">
                    {content.chatRoom.name}
                </Box>
                <Box
                    position="absolute"
                    bottom="0"
                    left="0"
                    right="0"
                    height="border"
                    backgroundColor="grey-5"
                />
            </Box>
            <Box style={{padding: createWidgetExampleDefaultPaddingAtDefaultScale}}>
                <Box
                    style={{
                        transformOrigin: "top left",
                        transform: `scale(${createWidgetExampleDocumentScale / createWidgetExampleDefaultScale})`,
                        width: `${(1 / (createWidgetExampleDocumentScale / createWidgetExampleDefaultScale)) * 100}%`,
                    }}
                >
                    <CreateWidgetChatMessageExampleContent content={content} />
                </Box>
            </Box>
        </Box>
    );
}
