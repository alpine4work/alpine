import {TestActualContext} from "~/admin/environment/test/unit/with_unit_test_environment.js";
import {ScreenshotTestRunner} from "~/app/screenshot_tests/helpers/run_screenshot_test.js";
import {getSearchEntityIndexesForTest} from "~/server/search/data/index/search_entity_index.js";

const databasesScreenshotTime = new Date("2025-10-07T13:00:00-04:00");
const {SearchEntityKeywordIndex} = getSearchEntityIndexesForTest();

export async function run(context: TestActualContext, runner: ScreenshotTestRunner) {
    const {space, accounts} = await runner.createDemoSpace(context);
    const cass = accounts.cassCade;

    // Sign in and set the page up (fixed clock, viewport, reduced motion) on a neutral
    // route. The databases routes keep the shared database worker's script request
    // open, so `runner.goto`'s network-idle wait would time out on them — navigate
    // within this page instead.
    await runner.goto(cass, `/dev/empty/${space.id}`, {fixedTime: databasesScreenshotTime});

    // Cass sets up Cliff's sales pipeline as linked databases. Create the linked
    // tables first so they show up in the field creation UI's table list, then the
    // "Deals" table we take all the screenshots on.
    const customersUrl = await createDatabase(runner, space.id, "Customers");
    await createDatabase(runner, space.id, "Contacts");
    await createDatabase(runner, space.id, "Case studies");
    const dealsUrl = await createDatabase(runner, space.id, "Deals");

    // The linked-table picker searches OpenSearch. Wait for table indexing jobs and
    // make their writes visible before opening the picker.
    await runner.drainBackgroundWork();
    await context.opensearch.refresh(SearchEntityKeywordIndex);

    // Reload before writing rows: on the page reached through the create navigation
    // the database worker replica may not have received the new table yet, and writes
    // issued before it catches up are rejected.
    await gotoDatabasesPath(runner, dealsUrl);
    await runner.getByText("New row", {exact: true}).waitFor();

    await createDatabaseRow(runner, "Acme Corp expansion");
    await createDatabaseRow(runner, "Inbound from the case study");
    await createDatabaseRow(runner, "Warm referral pilot");

    await runner.mouse.move(0, 0);
    await runner.screenshot("a0", "grid");

    // Open the field creation popover: field name input in the header with the field
    // type list below it. "Text" starts highlighted and doubles as the default name
    // shown in the input placeholder.
    await runner.getByLabel("Add field").click();
    await runner.getByRole("option", {name: "Text"}).waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a1", "field-creation");

    // Type a name and move the highlighted type down to "Number" with the arrow keys.
    // Focus stays on the name input the whole time.
    await runner.getByLabel("Field name").fill("Deal size");
    await runner.page.keyboard.press("ArrowDown");
    await runner.page.keyboard.press("ArrowDown");
    await runner.screenshot("a2", "field-creation-keyboard-selection");

    // Enter creates the field with the highlighted type ("Number").
    await runner.page.keyboard.press("Enter");
    await runner.getByRole("button", {name: "Deal size"}).waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a3", "field-created-number");

    // Relation fields get a second screen: a linked table picker with a filter input,
    // the scrollable table list, and the cardinality toggle at the bottom.
    await runner.getByLabel("Add field").click();
    await runner.getByRole("option", {name: "Linked record"}).click();
    await runner.getByRole("option", {name: "Customers"}).waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a4", "field-creation-linked-record");

    await runner.getByLabel("Filter tables").fill("cust");
    await runner.getByRole("option", {name: "Contacts"}).waitFor({state: "detached"});
    await runner.screenshot("a5", "field-creation-linked-record-filtered");

    // Enter creates the relation field. The name input was left empty so the field
    // defaults to the linked table's name.
    await runner.page.keyboard.press("Enter");
    await runner.getByRole("button", {name: "Customers"}).waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a6", "field-created-linked-record");

    // Populate the Customers table so the Deals → Customers relation has records to
    // link and search over.
    await gotoDatabasesPath(runner, customersUrl);
    await runner.getByText("New row", {exact: true}).waitFor();
    for (const name of [
        "Acme Corp",
        "Northwind Trading",
        "Meridian Labs",
        "Cobalt Systems",
        "Everpeak Retail",
    ]) {
        await createDatabaseRow(runner, name);
    }

    // Back on the Deals grid, open the "Customers" linked-record cell on the first
    // deal. Clicking the cell opens the linked-record picker: a search box and the
    // linked table's name in the header, with the linkable Customers records below.
    await gotoDatabasesPath(runner, dealsUrl);
    await runner.getByText("New row", {exact: true}).waitFor();
    const customersCell = runner.page
        .locator("[data-testid=DatabaseGridViewCell][data-field-name=Customers]")
        .first();
    await customersCell.click();
    await runner.getByLabel("Search records").waitFor();
    await runner.getByRole("option", {name: "Acme Corp", exact: true}).waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a7", "linked-record-editor");

    // Link two customers. Each linked record shows a drag handle for reordering and a
    // remove button, above the "Add more" list of remaining candidates.
    await runner.getByLabel("Search records").fill("Northwind Trading");
    await runner.getByRole("option", {name: "Northwind Trading", exact: true}).waitFor();
    await runner.page.keyboard.press("ArrowDown");
    await runner.page.keyboard.press("Enter");
    await runner.getByRole("button", {name: "Remove Northwind Trading"}).waitFor();
    await runner.getByLabel("Search records").fill("Meridian Labs");
    await runner.getByRole("option", {name: "Meridian Labs", exact: true}).waitFor();
    await runner.page.keyboard.press("ArrowDown");
    await runner.page.keyboard.press("Enter");
    await runner.getByRole("button", {name: "Remove Meridian Labs"}).waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("a8", "linked-record-editor-linked");

    // Typing a search filters the candidates through a query against the linked
    // database and offers to create a new record. The linked records hide while
    // searching.
    await runner.getByLabel("Search records").fill("co");
    await runner.getByRole("button", {name: "Create co"}).waitFor();
    // "Everpeak Retail" has no "co" so it drops out of the filtered candidates.
    await runner
        .getByRole("option", {name: "Everpeak Retail", exact: true})
        .waitFor({state: "detached"});
    await runner.mouse.move(0, 0);
    await runner.screenshot("a9", "linked-record-editor-search");

    // Close the linked-record editor before testing the database title interaction.
    await runner.page.keyboard.press("Escape");
    await runner.getByLabel("Search records").waitFor();
    await runner.page.keyboard.press("Escape");
    await runner.getByLabel("Search records").waitFor({state: "detached"});
    await runner.getByRole("heading", {name: "Deals"}).waitFor();

    // Database names use the same inline title editor as task collections. A double
    // click selects the current name and shows the title-sized input focus ring.
    await runner.getByRole("heading", {name: "Deals"}).dispatchEvent("pointerdown");
    await runner.getByRole("heading", {name: "Deals"}).dispatchEvent("pointerdown");
    await runner.getByLabel("Database name").and(runner.page.locator(":focus")).waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("b00", "database-name-editor");

    // Replace the name. The input grows with its content and stays aligned with the
    // share action.
    await runner.getByLabel("Database name").fill("Sales pipeline");
    await runner.mouse.move(0, 0);
    await runner.screenshot("b01", "database-name-editor-changed");

    // Losing focus asks for confirmation. It does not save the DynamoDB name silently.
    await runner.getByText("New row", {exact: true}).click();
    await runner.getByText("Save database name").waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("b02", "database-name-editor-confirm-save");

    // Discard returns to the original title. Then repeat the interaction and save with
    // Enter to cover the direct keyboard flow and the propagated final state.
    await runner.getByRole("button", {name: "Discard name"}).click();
    await runner.getByRole("heading", {name: "Deals"}).waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("b03", "database-name-editor-discarded");

    await runner.getByRole("heading", {name: "Deals"}).dispatchEvent("pointerdown");
    await runner.getByLabel("Database name").fill("Sales pipeline");
    await runner.getByLabel("Database name").press("Enter");
    await runner.getByRole("heading", {name: "Sales pipeline"}).waitFor();
    await runner.mouse.move(0, 0);
    await runner.screenshot("b04", "database-name-renamed");
}

/**
 * Navigate the current page to a databases route without waiting for network idle,
 * then wait for the app to be ready and suppress hints like `runner.goto()` does.
 */
async function gotoDatabasesPath(runner: ScreenshotTestRunner, pathOrUrl: string) {
    await runner.page.goto(new URL(pathOrUrl, runner.page.url()).toString());
    // eslint-disable-next-line cyberworlds/string-quotes
    await runner.page.waitForFunction("typeof dev !== 'undefined' && dev.ready");
    await runner.page.evaluate("dev.hints && dev.hints.toggleSuppression()");
}

/**
 * Creates a database through the UI and lands on its grid view. Returns the grid
 * view URL so callers can navigate back to it later.
 */
async function createDatabase(
    runner: ScreenshotTestRunner,
    spaceId: string,
    name: string,
): Promise<string> {
    await gotoDatabasesPath(runner, `/database/new/${spaceId}?focus=name`);
    await runner.getByLabel("Name").fill(name);
    await runner.getByTestId("NavigationBar").getByRole("button", {name: "Create"}).click();
    await runner.getByText("New row", {exact: true}).waitFor();
    return runner.page.url();
}

/**
 * Creates a row through the UI. Clicking "New row" creates the row and immediately
 * opens the first cell's editor, so fill it and close with escape.
 */
async function createDatabaseRow(runner: ScreenshotTestRunner, name: string) {
    await runner.getByText("New row", {exact: true}).click();
    const editor = runner.page.locator("textarea").last();
    await editor.waitFor();
    await editor.fill(name);
    await editor.press("Escape");
    await runner.getByText(name, {exact: true}).waitFor();
}
