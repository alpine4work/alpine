import {CalendarDate, parseAbsolute, toCalendarDate} from "@internationalized/date";
import {useMemo, useState} from "react";
import {Box} from "~/client/design/box";
import {useCurrentTimeRoundedToHour} from "~/client/helpers/use_current_time_rounded_to_hour";
import {useClientInfo} from "~/client/remix/client_info_context";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title";
// NOCOMMIT: Should not be in an internal directory
// eslint-disable-next-line no-internal-imports
import {TaskTitle, createSimpleTaskTitle} from "~/client/tasks/internal/task_title_schema";
import {LocalTaskCollection} from "~/client/tasks/playground/local_task_collection";
import {TaskCardPresentationalView} from "~/client/tasks/playground/task_card_presentational_view";
import {TaskDetailPresentationalView} from "~/client/tasks/playground/task_detail_presentational_view";
import {TaskStatus} from "~/client/tasks/playground/task_status_button";
import {noop} from "~/shared/helpers/control/noop";
import {assertId} from "~/shared/id/id";
import {AccountId, LocalTaskCollectionId} from "~/shared/id/types/id_types";
import {AccountModel} from "~/shared/models/account_model";
import {sprinkles} from "~/shared/styles/styles";

export function meta() {
    return {
        title: `Tasks Design Playground${metaTitlePostfix}`,
    };
}

const account1 = new AccountModel({
    id: assertId<AccountId>("tep7a4qm9w80ccyhqh56cnf08c"),
    name: "Logan Roy",
    createdTime: new Date("2023-05-22T17:30:24.653Z"),
});

const account2 = new AccountModel({
    id: assertId<AccountId>("e12zp2m60pam4cf6k0ej4mttfc"),
    name: "Siobahn Roy",
    createdTime: new Date("2023-05-22T17:30:24.653Z"),
});

const account3 = new AccountModel({
    id: assertId<AccountId>("x3bekvne562ty8g5x9bb4eptj8"),
    name: "Kendall Roy",
    createdTime: new Date("2023-05-22T17:30:24.653Z"),
});

const account4 = new AccountModel({
    id: assertId<AccountId>("9khstzn60vzx2ee88pv8ym1dsg"),
    name: "Roman Roy",
    createdTime: new Date("2023-05-22T17:30:24.653Z"),
});

const kitchenTaskCollection: LocalTaskCollection = {
    id: assertId<LocalTaskCollectionId>("vxydptp0bf9zxnwm2gx38h2k7r"),
    name: "Kitchen",
    color: "blue",
};

const bathroomTaskCollection: LocalTaskCollection = {
    id: assertId<LocalTaskCollectionId>("vxydptp0bf9zxnwm2gx38h2k7r"),
    name: "Bathroom",
    color: "orange",
};

export default function TasksDesignPlaygroundRoute() {
    const {timeZone} = useClientInfo();
    const currentTime = useCurrentTimeRoundedToHour();
    const currentDate = useMemo(
        () => toCalendarDate(parseAbsolute(currentTime.toISOString(), timeZone)),
        [currentTime, timeZone],
    );

    return (
        <main
            className={sprinkles({
                display: "flex",
                flexDirection: "column",
                padding: "24",
                gap: "64",
            })}
        >
            <Box backgroundColor="grey-0" border="grey-10" borderRadius="md">
                <Box paddingX="5">
                    <Box height="9" display="flex" alignItems="center" borderBottom="grey-5">
                        Task row 1
                    </Box>
                </Box>
                <Box paddingX="5">
                    <Box height="9" display="flex" alignItems="center" borderBottom="grey-5">
                        Task row 2
                    </Box>
                </Box>
                <Box paddingX="5">
                    <Box height="9" display="flex" alignItems="center" borderBottom="grey-5">
                        Task row 3
                    </Box>
                </Box>
                <Box paddingX="5">
                    <Box height="9" display="flex" alignItems="center" borderBottom="grey-5">
                        Task row 4
                    </Box>
                </Box>
                <Box paddingX="5">
                    <Box height="9" display="flex" alignItems="center" borderBottom="grey-5">
                        Task row 5
                    </Box>
                </Box>
                <Box paddingX="5">
                    <Box height="9" display="flex" alignItems="center" borderBottom="grey-5">
                        Task row 6
                    </Box>
                </Box>
                <Box paddingX="5">
                    <Box height="9" display="flex" alignItems="center" borderBottom="grey-5">
                        Task row 7
                    </Box>
                </Box>
                <Box paddingX="5">
                    <Box height="9" display="flex" alignItems="center">
                        Task row 8
                    </Box>
                </Box>
            </Box>
            <Box display="flex" gap="4">
                <Box width="full" maxWidth="96" display="flex" flexDirection="column" gap="4">
                    <TaskCardPresentationalView
                        status="Open"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle(
                            "Clean the kitchen: Wash the dishes, wipe down countertops, clean appliances (such as the oven and refrigerator), and sweep or mop the floor",
                        )}
                        assignee={account4}
                        dueDate={currentDate.copy().subtract({days: 1})}
                        collections={[kitchenTaskCollection]}
                    />
                    <TaskCardPresentationalView
                        status="Open"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle("Sort, wash, dry, and fold clothes")}
                        assignee={null}
                        dueDate={currentDate.copy().add({days: 7})}
                        collections={[kitchenTaskCollection, bathroomTaskCollection]}
                    />
                </Box>
                <Box width="full" maxWidth="96" display="flex" flexDirection="column" gap="4">
                    <TaskCardPresentationalView
                        status="Closed"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle("Vacuum and mop floors")}
                        assignee={account2}
                        dueDate={null}
                        collections={[]}
                    />
                </Box>
            </Box>
            <Box display="flex" justifyContent="space-between" gap="4">
                <Box
                    backgroundColor="grey-0"
                    flexShrink="0"
                    width="192"
                    style={{height: "56rem"}}
                    boxShadow="elevation-5"
                    borderRadius="lg"
                    overflow="hidden"
                >
                    <TaskDetailDemoView
                        initialStatus="Open"
                        initialTitle={createSimpleTaskTitle(
                            "Clean the kitchen: Wash the dishes, wipe down countertops, clean appliances (such as the oven and refrigerator), and sweep or mop the floor",
                        )}
                        initialAssignee={account4}
                        initialDueDate={currentDate}
                        initialCollections={[kitchenTaskCollection]}
                    />
                </Box>
                <Box
                    flexGrow="1"
                    overflow="hidden"
                    padding="1"
                    margin="-1"
                    display="flex"
                    flexDirection="column"
                    gap="4"
                >
                    <TaskCardPresentationalView
                        status="Closed"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle(
                            "Clean out the fridge: Remove expired items and wipe shelves",
                        )}
                        assignee={account3}
                        dueDate={currentDate}
                        collections={[kitchenTaskCollection]}
                    />
                    <TaskCardPresentationalView
                        status="Open"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle("Clean windows and mirrors")}
                        assignee={account3}
                        dueDate={currentDate.copy().add({days: 1})}
                        collections={[bathroomTaskCollection, kitchenTaskCollection]}
                    />
                    <TaskCardPresentationalView
                        status="Open"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle(
                            "Deep clean the kitchen: Remove all items from the countertops and wipe them down. Scrub the sink, faucet, and stovetop using appropriate cleaners. Clean the oven, inside and out, by following the manufacturer's instructions. Sweep and mop the floor, paying attention to corners and hard-to-reach areas",
                        )}
                        assignee={null}
                        dueDate={null}
                        collections={[kitchenTaskCollection]}
                    />
                    <TaskCardPresentationalView
                        status="Closed"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle("Tidy up the living room")}
                        assignee={null}
                        dueDate={currentDate.copy().subtract({days: 7})}
                        collections={[]}
                    />
                    <TaskCardPresentationalView
                        status="Closed"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle("Declutter and organize")}
                        assignee={null}
                        dueDate={null}
                        collections={[]}
                    />
                    <TaskCardPresentationalView
                        status="Open"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle(
                            "Remember to take breaks and reward yourself for your hard work!",
                        )}
                        assignee={account1}
                        dueDate={currentDate.copy().subtract({years: 2})}
                        collections={[]}
                    />
                </Box>
            </Box>
        </main>
    );
}

function TaskDetailDemoView({
    initialStatus,
    initialTitle,
    initialAssignee,
    initialDueDate,
    initialCollections,
}: {
    initialStatus: TaskStatus;
    initialTitle: TaskTitle;
    initialAssignee: AccountModel;
    initialDueDate: CalendarDate | null;
    initialCollections: ReadonlyArray<LocalTaskCollection>;
}) {
    const [status, setStatus] = useState(initialStatus);
    const [title, setTitle] = useState(initialTitle);
    const [assignee] = useState(initialAssignee);
    const [dueDate, setDueDate] = useState(initialDueDate);
    const [collections] = useState(initialCollections);

    return (
        <TaskDetailPresentationalView
            status={status}
            onStatusChange={setStatus}
            title={title}
            onTitleChange={setTitle}
            assignee={assignee}
            dueDate={dueDate}
            onDueDateChange={setDueDate}
            collections={collections}
        />
    );
}
