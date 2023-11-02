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

        // TODO(calebmer): `displayStatus`, `assignee`, `priority`, and `dueDate`
        // expectations.

        switch (displayStatus) {
            case "OpenInactive": {
                await expect(locator.getByRole("img", {name: "Open", exact: true})).toBeVisible();
                break;
            }
            case "OpenActive": {
                await expect(
                    locator.getByRole("img", {name: "Open (active)", exact: true}),
                ).toBeVisible();
                break;
            }
            case "Closed": {
                await expect(locator.getByRole("img", {name: "Closed", exact: true})).toBeVisible();
                break;
            }
            default:
                throw exhaustive(displayStatus);
        }

        await expect(locator.getByLabel("Title")).toHaveText(title);

        await expect(locator).toHaveAttribute("data-indentation", String(indentation));
        if (children.length === 0) {
            await expect(locator).not.toHaveText(new RegExp(`\\d+/\\d+`));
        } else {
            await expect(locator).toHaveText(new RegExp(`\\d+/${children.length}`));
        }

        for (const childTaskDefinition of children) {
            await expectTaskDefinition(indentation + 1, childTaskDefinition);
        }
    };

    for (const taskDefinition of taskDefinitions) {
        await expectTaskDefinition(0, taskDefinition);
    }

    await expect(page.getByTestId(/^TaskRowView:/)).toHaveCount(taskCount + 1);
}
