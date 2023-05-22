import {UserCircle} from "phosphor-react";
import {useMemo} from "react";
import {AccountAvatar} from "~/client/accounts/account_avatar";
import {AccountShortName} from "~/client/accounts/account_short_name";
import {Box} from "~/client/design/box";
import {TaskTitle} from "~/client/tasks/internal/task_title_schema";
import {TaskStatus, TaskStatusButton} from "~/client/tasks/playground/task_status_button";
import {parseRemLengthNumber, spacing} from "~/shared/design/spacing";
import {AccountModel} from "~/shared/models/account_model";
import {serializeProsemirrorFragmentToHtml} from "~/shared/prosemirror/serialize_prosemirror_node_to_html";
import {colorSchemeVars, contentSchemaStyles, sprinkles} from "~/shared/styles/styles";

// TODO(calebmer): Needs:
//
// [x] Title
// [x] Open/close button
// [x] Assignee field
// [ ] Due date field
// [ ] Collections field
// [ ] Custom fields
// [ ] Subtasks
// [ ] Open detail interaction

export function TaskCardPresentationalView({
    status,
    onStatusChange,
    title,
    assignee,
}: {
    status: TaskStatus;
    onStatusChange: (status: TaskStatus) => void;
    title: TaskTitle;
    assignee: AccountModel | null;
}) {
    return (
        <Box
            width="full"
            maxWidth="96"
            boxShadow="elevation-10"
            borderRadius="lg"
            padding="5"
            display="flex"
            flexDirection="column"
            gap="5"
        >
            <Box
                display="flex"
                gap="3"
                // Extra margin on the right to balance margin on the left from status button.
                paddingRight="3"
            >
                <Box
                    flexShrink="0"
                    display="flex"
                    alignItems="center"
                    style={{height: contentSchemaStyles.paragraphFontSize.lineHeight}}
                >
                    <TaskStatusButton status={status} onStatusChange={onStatusChange} />
                </Box>
                <Box
                    flexGrow="1"
                    fontSize="100"
                    color={status === "Closed" ? "grey-60" : "grey-text"}
                    style={{
                        overflow: "hidden",
                        ...contentSchemaStyles.paragraphFontSize,
                        maxHeight: `${
                            parseRemLengthNumber(contentSchemaStyles.paragraphFontSize.lineHeight) *
                            3
                        }rem`,
                        // Truncate after 3 lines of text. Unofficial syntax that works in all browsers
                        // except IE.
                        // https://stackoverflow.com/questions/3922739/limit-text-length-to-n-lines-using-css
                        display: "-webkit-box",
                        WebkitLineClamp: 3,
                        lineClamp: 3,
                        WebkitBoxOrient: "vertical",
                        textOverflow: "ellipsis",
                    }}
                    dangerouslySetInnerHTML={useMemo(
                        () => ({
                            __html: serializeProsemirrorFragmentToHtml(title.content),
                        }),
                        [title],
                    )}
                />
            </Box>
            {assignee && (
                <Box display="flex" alignItems="center" gap="3" maxWidth="32">
                    <Box position="relative" width="4" height="4">
                        {assignee ? (
                            <Box position="absolute" top="-1" left="-1">
                                <AccountAvatar size="6" account={assignee} />
                            </Box>
                        ) : (
                            <UserCircle
                                size={spacing["7"]}
                                color={colorSchemeVars["grey-20"]}
                                weight="thin"
                                className={sprinkles({
                                    position: "absolute",
                                    left: "-1.5",
                                    top: "-1.5",
                                })}
                            />
                        )}
                    </Box>
                    <Box fontStyle="truncate" color="grey-60">
                        <AccountShortName account={assignee} tooltipPlacement="bottom" />
                    </Box>
                </Box>
            )}
        </Box>
    );
}
