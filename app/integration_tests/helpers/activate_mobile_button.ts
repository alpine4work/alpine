import {type Page, expect} from "@playwright/test";
import {InternalError} from "~/shared/error/error.open_source.js";

/**
 * Activates a mobile button after clearing focus-driven mobile UI.
 */
export async function activateMobileButton(page: Page, name: string) {
    await page.evaluate(() => {
        if (document.activeElement instanceof HTMLElement) {
            document.activeElement.blur();
        }
    });

    const mobileChromeButton = page.getByRole("button", {name});
    await expect(mobileChromeButton).toBeVisible();

    const mobileChromeButtonHandle = await mobileChromeButton.elementHandle();
    if (mobileChromeButtonHandle === null) {
        throw new InternalError("Expected mobile chrome button to have an element handle.");
    }

    await mobileChromeButtonHandle.waitForElementState("stable");

    const didClick = await mobileChromeButtonHandle.evaluate(element => {
        if (element instanceof HTMLElement) {
            element.click();
            return true;
        }

        return false;
    });
    if (!didClick) throw new InternalError("Expected mobile chrome button to be an HTML element.");
}
