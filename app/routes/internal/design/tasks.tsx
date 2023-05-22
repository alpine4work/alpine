import {Box} from "~/client/design/box";
import {metaTitlePostfix} from "~/client/remix/use_update_meta_title";
import {createSimpleTaskTitle} from "~/client/tasks/internal/task_title_schema";
import {TaskCardPresentationalView} from "~/client/tasks/playground/task_card_presentational_view";
import {noop} from "~/shared/helpers/control/noop";
import {sprinkles} from "~/shared/styles/styles";

export function meta() {
    return {
        title: `Tasks Design Playground${metaTitlePostfix}`,
    };
}

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
                    />
                    <TaskCardPresentationalView
                        status="Closed"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle("Sort, wash, dry, and fold clothes")}
                    />
                </Box>
                <Box width="full" maxWidth="96" display="flex" flexDirection="column" gap="4">
                    <TaskCardPresentationalView
                        status="Open"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle("Vacuum and mop floors")}
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
                    />
                    <TaskCardPresentationalView
                        status="Open"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle("Clean windows and mirrors")}
                    />
                    <TaskCardPresentationalView
                        status="Open"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle(
                            "Deep clean the kitchen: Remove all items from the countertops and wipe them down. Scrub the sink, faucet, and stovetop using appropriate cleaners. Clean the oven, inside and out, by following the manufacturer's instructions. Sweep and mop the floor, paying attention to corners and hard-to-reach areas",
                        )}
                    />
                    <TaskCardPresentationalView
                        status="Closed"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle("Tidy up the living room")}
                    />
                    <TaskCardPresentationalView
                        status="Open"
                        onStatusChange={noop}
                        title={createSimpleTaskTitle(
                            "Remember to take breaks and reward yourself for your hard work!",
                        )}
                    />
                </Box>
            </Box>
        </main>
    );
}
