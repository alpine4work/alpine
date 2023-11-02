import {Page, expect} from "@playwright/test";
import {exhaustive} from "~/shared/helpers/control/exhaustive.js";
import {TaskDisplayStatus} from "~/shared/tasks/task_display_status.js";

type ExpectTaskGridViewTaskDefinitionAttributes = [
    status: TaskDisplayStatus | boolean,
    title: string,
    assignee?: string,
    priority?: string,
    dueDate?: string,
];

export type ExpectTaskGridViewTaskDefinition =
    | ExpectTaskGridViewTaskDefinitionAttributes
    | [
          attributes: ExpectTaskGridViewTaskDefinitionAttributes,
          children: Array<ExpectTaskGridViewTaskDefinition>,
      ];

function getExpectTaskGridViewTaskDefinitionAttributes(
    taskDefinition: ExpectTaskGridViewTaskDefinition,
): ExpectTaskGridViewTaskDefinitionAttributes {
    if (Array.isArray(taskDefinition[0])) return taskDefinition[0];
    return taskDefinition as ExpectTaskGridViewTaskDefinitionAttributes;
}

function getExpectTaskGridViewTaskDefinitionChildren(
    taskDefinition: ExpectTaskGridViewTaskDefinition,
): Array<ExpectTaskGridViewTaskDefinition> {
    const children = taskDefinition[1];
    if (!children || !Array.isArray(children)) return [];
    return children;
}

/**
 * Convenient function for asserting a task grid view has all the tasks you
 * expect with the right data in each position.
 */
export async function expectTaskGridView(
    page: Page,
    taskDefinitions: Array<ExpectTaskGridViewTaskDefinition>,
    {hasGhostTaskRow = true}: {hasGhostTaskRow?: boolean} = {},
) {
    let taskCount = 0;

    const expectTaskDefinition = async (
        indentation: number,
        taskDefinition: ExpectTaskGridViewTaskDefinition,
    ) => {
        const locator = page.getByTestId(/^TaskRowView:/).nth(taskCount);
        taskCount++;

        const attributes = getExpectTaskGridViewTaskDefinitionAttributes(taskDefinition);
        const children = getExpectTaskGridViewTaskDefinitionChildren(taskDefinition);

        const displayStatus: TaskDisplayStatus =
            typeof attributes[0] === "boolean"
                ? attributes[0]
                    ? "OpenInactive"
                    : "Closed"
                : attributes[0];

        const title = attributes[1];
        const assignee = attributes[2] ?? "";
        const priority = attributes[3] ?? "";
        const dueDate = attributes[4] ?? "";

        switch (displayStatus) {
            case "OpenInactive": {
                await expect(
                    locator
                        .getByTestId("TaskStatusButton")
                        .getByRole("img", {name: "Open", exact: true}),
                ).toBeVisible();
                break;
            }
            case "OpenActive": {
                await expect(
                    locator
                        .getByTestId("TaskStatusButton")
                        .getByRole("img", {name: "Open (active)", exact: true}),
                ).toBeVisible();
                break;
            }
            case "Closed": {
                await expect(
                    locator
                        .getByTestId("TaskStatusButton")
                        .getByRole("img", {name: "Closed", exact: true}),
                ).toBeVisible();
                break;
            }
            default:
                throw exhaustive(displayStatus);
        }

        await expect(locator.getByRole("textbox", {name: "Title"})).toHaveText(title);

        if (await locator.getByLabel("Assignee").isVisible()) {
            await expect(locator.getByLabel("Assignee")).toHaveValue(assignee);
        } else {
            await expect(locator.getByTestId("TaskRowAssigneeCell")).toHaveText(
                // Use regex since text may start with the avatar's initials.
                new RegExp(`[A-Z0-9]{0,2}${escapeRegExp(assignee)}`),
            );
        }

        if (await locator.getByLabel("Priority").isVisible()) {
            await expect(locator.getByLabel("Priority")).toHaveValue(priority);
        } else {
            await expect(locator.getByTestId("TaskRowPriorityCell")).toHaveText(priority);
        }

        if (
            (await locator.getByLabel("Due date", {exact: true}).isVisible()) ||
            dueDate.length > 0
        ) {
            await expect(locator.getByLabel("Due date", {exact: true})).toHaveText(
                dueDate.length === 0 ? "mm/dd/yyyy" : dueDate,
            );
        }

        await expect(locator).toHaveAttribute("data-indentation", String(indentation));
        if (children.length === 0) {
            await expect(locator.getByTestId("TaskRowTitleCell")).not.toHaveText(
                new RegExp(`\\d+/\\d+`),
            );
        } else {
            await expect(locator.getByTestId("TaskRowTitleCell")).toHaveText(
                new RegExp(`\\d+/${children.length}`),
            );
        }

        for (const childTaskDefinition of children) {
            await expectTaskDefinition(indentation + 1, childTaskDefinition);
        }
    };

    for (const taskDefinition of taskDefinitions) {
        await expectTaskDefinition(0, taskDefinition);
    }

    await expect(page.getByTestId(/^TaskRowView:/)).toHaveCount(
        taskCount + (hasGhostTaskRow ? 1 : 0),
    );
}

function escapeRegExp(string: string) {
    return string.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
