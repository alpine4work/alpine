import {Box} from "~/client/design/box";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title";
// NOCOMMIT: Should not be in an internal directory
// eslint-disable-next-line no-internal-imports
import {createSimpleTaskTitle} from "~/client/tasks/internal/task_title_schema";
import {TaskCardPresentationalView} from "~/client/tasks/playground/task_card_presentational_view";
import {noop} from "~/shared/helpers/control/noop";
import {assertId} from "~/shared/id/id";
import {AccountId} from "~/shared/id/types/id_types";
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

export default function TasksDesignPlaygroundRoute() {
    return (
        <main
            className={sprinkles({
                backgroundColor: "grey-0",
                display: "flex",
                flexDirection: "column",
                padding: "24",
                gap: "64",
            })}
            style={{minHeight: "100%"}}
        >
            <Box border="grey-10" borderRadius="md">
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
                    />
                    <TaskCardPresentationalView
                        status="Open"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle("Sort, wash, dry, and fold clothes")}
                        assignee={null}
                    />
                </Box>
                <Box width="full" maxWidth="96" display="flex" flexDirection="column" gap="4">
                    <TaskCardPresentationalView
                        status="Closed"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle("Vacuum and mop floors")}
                        assignee={account2}
                    />
                </Box>
            </Box>
            <Box display="flex" justifyContent="space-between" gap="4">
                <Box
                    flexShrink="0"
                    width="192"
                    style={{height: "56rem"}}
                    padding="24"
                    border="grey-10"
                    borderRadius="md"
                >
                    Task detail
                </Box>
                <Box flexGrow="1" display="flex" flexDirection="column" gap="4">
                    <TaskCardPresentationalView
                        status="Closed"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle(
                            "Clean out the fridge: Remove expired items and wipe shelves",
                        )}
                        assignee={account3}
                    />
                    <TaskCardPresentationalView
                        status="Open"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle("Clean windows and mirrors")}
                        assignee={account3}
                    />
                    <TaskCardPresentationalView
                        status="Open"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle(
                            "Deep clean the kitchen: Remove all items from the countertops and wipe them down. Scrub the sink, faucet, and stovetop using appropriate cleaners. Clean the oven, inside and out, by following the manufacturer's instructions. Sweep and mop the floor, paying attention to corners and hard-to-reach areas",
                        )}
                        assignee={null}
                    />
                    <TaskCardPresentationalView
                        status="Closed"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle("Tidy up the living room")}
                        assignee={null}
                    />
                    <TaskCardPresentationalView
                        status="Open"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle(
                            "Remember to take breaks and reward yourself for your hard work!",
                        )}
                        assignee={account1}
                    />
                </Box>
            </Box>
        </main>
    );
}
