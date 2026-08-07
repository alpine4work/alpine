// We need to import this first so the test native mobile bridge is properly
// initialized.
//
// eslint-disable-next-line import/no-duplicates
import "~/client/web/remix/register_native_mobile_bridge_for_test.js";

import {Action, Location, To} from "@remix-run/router";
import {createPath} from "react-router";
import {NativeMobileMemoryHistory} from "~/app/router/native_mobile_router.js";
// eslint-disable-next-line import/no-duplicates
import {NativeMobileBridgeForTest} from "~/client/web/remix/register_native_mobile_bridge_for_test.js";
import {assert} from "~/shared/helpers/control/assert.open_source.js";

beforeEach(() => {
    history.replaceState(null, "", "/home");
});

let navigationRequestEventualExternalPopCount = 0;

NativeMobileBridgeForTest.navigation.subscribeToRequestEventualExternalPopForTest(() => {
    navigationRequestEventualExternalPopCount += 1;
});

beforeEach(() => {
    navigationRequestEventualExternalPopCount = 0;
});

afterEach(() => {
    assert(
        navigationRequestEventualExternalPopCount === 0,
        "Non-zero `navigationRequestEventualExternalPopCount` at the end of test, should call `expectNavigationRequestEventualExternalPopCount()`",
    );
});

function expectNavigationRequestEventualExternalPopCount(count: number) {
    expect(navigationRequestEventualExternalPopCount).toEqual(count);
    navigationRequestEventualExternalPopCount = 0;
}

function createHistory() {
    const history = new NativeMobileMemoryHistory();

    const router: {
        state: string;
        unstable_unsafelyRestoreNavigation: (options: {location: Location}) => void;
        navigate: (to: To, options?: {state?: any}) => Promise<void>;
    } = {
        state: createPath(window.location),
        unstable_unsafelyRestoreNavigation: ({location}: {location: Location}) => {
            router.state = createPath(location);
        },
        navigate: async (to, options) => {
            history.push(to, options?.state);
            router.state = typeof to === "string" ? to : createPath(to);
        },
    };

    history.initializeRouter(router as any);

    history.listen(({location}) => {
        router.state = createPath(location);
    });

    return {history, router};
}

test("history starts at `window.location`", async () => {
    const {history} = createHistory();

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.getEntryKey()).toEqual("Home-000");
    expect(history.getInertRouterStates()).toEqual([]);
});

test("can push", async () => {
    const {history, router} = createHistory();

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.getEntryKey()).toEqual("Home-000");
    expect(history.getInertRouterStates()).toEqual([]);

    history.push("/page1");
    router.state = "/page1";

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.getEntryKey()).toEqual("Home-001");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-000", routerState: "/home"}]);

    history.push("/page2");
    router.state = "/page2";

    expect(createPath(window.location)).toEqual("/page2");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page2");
    expect(history.getEntryKey()).toEqual("Home-002");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
    ]);

    history.push("/page3");
    router.state = "/page3";

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.getEntryKey()).toEqual("Home-003");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
    ]);

    history.push("/page4");
    router.state = "/page4";

    expect(createPath(window.location)).toEqual("/page4");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page4");
    expect(history.getEntryKey()).toEqual("Home-004");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Home-003", routerState: "/page3"},
    ]);

    history.push("/page5");
    router.state = "/page5";

    expect(createPath(window.location)).toEqual("/page5");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page5");
    expect(history.getEntryKey()).toEqual("Home-005");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Home-003", routerState: "/page3"},
        {entryKey: "Home-004", routerState: "/page4"},
    ]);

    history.push("/page6");
    router.state = "/page6";

    expect(createPath(window.location)).toEqual("/page6");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page6");
    expect(history.getEntryKey()).toEqual("Home-006");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Home-003", routerState: "/page3"},
        {entryKey: "Home-004", routerState: "/page4"},
        {entryKey: "Home-005", routerState: "/page5"},
    ]);

    history.push("/page7");
    router.state = "/page7";

    expect(createPath(window.location)).toEqual("/page7");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page7");
    expect(history.getEntryKey()).toEqual("Home-007");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Home-003", routerState: "/page3"},
        {entryKey: "Home-004", routerState: "/page4"},
        {entryKey: "Home-005", routerState: "/page5"},
        {entryKey: "Home-006", routerState: "/page6"},
    ]);

    history.push("/page8");
    router.state = "/page8";

    expect(createPath(window.location)).toEqual("/page8");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page8");
    expect(history.getEntryKey()).toEqual("Home-008");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Home-003", routerState: "/page3"},
        {entryKey: "Home-004", routerState: "/page4"},
        {entryKey: "Home-005", routerState: "/page5"},
        {entryKey: "Home-006", routerState: "/page6"},
        {entryKey: "Home-007", routerState: "/page7"},
    ]);

    history.push("/page9");
    router.state = "/page9";

    expect(createPath(window.location)).toEqual("/page9");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page9");
    expect(history.getEntryKey()).toEqual("Home-009");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Home-003", routerState: "/page3"},
        {entryKey: "Home-004", routerState: "/page4"},
        {entryKey: "Home-005", routerState: "/page5"},
        {entryKey: "Home-006", routerState: "/page6"},
        {entryKey: "Home-007", routerState: "/page7"},
        {entryKey: "Home-008", routerState: "/page8"},
    ]);
});

test("can switch tabs", async () => {
    const {history, router} = createHistory();

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.getEntryKey()).toEqual("Home-000");
    expect(history.getInertRouterStates()).toEqual([]);

    history.push("/page1");
    router.state = "/page1";

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.getEntryKey()).toEqual("Home-001");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-000", routerState: "/home"}]);

    history.push("/page2");
    router.state = "/page2";

    expect(createPath(window.location)).toEqual("/page2");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page2");
    expect(history.getEntryKey()).toEqual("Home-002");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
    ]);

    history.push("/page3");
    router.state = "/page3";

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.getEntryKey()).toEqual("Home-003");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
    ]);

    await history.switchTabFromExternal("Inbox", new URL("/inbox", window.location.href));

    expect(createPath(window.location)).toEqual("/inbox");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/inbox");
    expect(history.getEntryKey()).toEqual("Inbox-000");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Home-003", routerState: "/page3"},
    ]);

    history.push("/page4");
    router.state = "/page4";

    expect(createPath(window.location)).toEqual("/page4");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page4");
    expect(history.getEntryKey()).toEqual("Inbox-001");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Home-003", routerState: "/page3"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
    ]);

    history.push("/page5");
    router.state = "/page5";

    expect(createPath(window.location)).toEqual("/page5");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page5");
    expect(history.getEntryKey()).toEqual("Inbox-002");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Home-003", routerState: "/page3"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page4"},
    ]);

    history.push("/page6");
    router.state = "/page6";

    expect(createPath(window.location)).toEqual("/page6");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page6");
    expect(history.getEntryKey()).toEqual("Inbox-003");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Home-003", routerState: "/page3"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page4"},
        {entryKey: "Inbox-002", routerState: "/page5"},
    ]);

    history.push("/page7");
    router.state = "/page7";

    expect(createPath(window.location)).toEqual("/page7");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page7");
    expect(history.getEntryKey()).toEqual("Inbox-004");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Home-003", routerState: "/page3"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page4"},
        {entryKey: "Inbox-002", routerState: "/page5"},
        {entryKey: "Inbox-003", routerState: "/page6"},
    ]);

    await history.switchTabFromExternal("Search", new URL("/search", window.location.href));

    expect(createPath(window.location)).toEqual("/search");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/search");
    expect(history.getEntryKey()).toEqual("Search-000");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Home-003", routerState: "/page3"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page4"},
        {entryKey: "Inbox-002", routerState: "/page5"},
        {entryKey: "Inbox-003", routerState: "/page6"},
        {entryKey: "Inbox-004", routerState: "/page7"},
    ]);

    history.push("/page8");
    router.state = "/page8";

    expect(createPath(window.location)).toEqual("/page8");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page8");
    expect(history.getEntryKey()).toEqual("Search-001");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-003", routerState: "/page3"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page4"},
        {entryKey: "Inbox-002", routerState: "/page5"},
        {entryKey: "Inbox-003", routerState: "/page6"},
        {entryKey: "Inbox-004", routerState: "/page7"},
        {entryKey: "Search-000", routerState: "/search"},
    ]);

    history.push("/page9");
    router.state = "/page9";

    expect(createPath(window.location)).toEqual("/page9");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page9");
    expect(history.getEntryKey()).toEqual("Search-002");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page4"},
        {entryKey: "Inbox-002", routerState: "/page5"},
        {entryKey: "Inbox-003", routerState: "/page6"},
        {entryKey: "Inbox-004", routerState: "/page7"},
        {entryKey: "Search-000", routerState: "/search"},
        {entryKey: "Search-001", routerState: "/page8"},
    ]);

    history.push("/page10");
    router.state = "/page10";

    expect(createPath(window.location)).toEqual("/page10");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page10");
    expect(history.getEntryKey()).toEqual("Search-003");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Inbox-001", routerState: "/page4"},
        {entryKey: "Inbox-002", routerState: "/page5"},
        {entryKey: "Inbox-003", routerState: "/page6"},
        {entryKey: "Inbox-004", routerState: "/page7"},
        {entryKey: "Search-000", routerState: "/search"},
        {entryKey: "Search-001", routerState: "/page8"},
        {entryKey: "Search-002", routerState: "/page9"},
    ]);

    await history.switchTabFromExternal("Home", new URL("/page3", window.location.href));

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.getEntryKey()).toEqual("Home-003");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Inbox-002", routerState: "/page5"},
        {entryKey: "Inbox-003", routerState: "/page6"},
        {entryKey: "Inbox-004", routerState: "/page7"},
        {entryKey: "Search-000", routerState: "/search"},
        {entryKey: "Search-001", routerState: "/page8"},
        {entryKey: "Search-002", routerState: "/page9"},
        {entryKey: "Search-003", routerState: "/page10"},
    ]);

    await history.switchTabFromExternal("Inbox", new URL("/page7", window.location.href));

    expect(createPath(window.location)).toEqual("/page7");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page7");
    expect(history.getEntryKey()).toEqual("Inbox-004");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Search-000", routerState: "/search"},
        {entryKey: "Search-001", routerState: "/page8"},
        {entryKey: "Search-002", routerState: "/page9"},
        {entryKey: "Search-003", routerState: "/page10"},
        {entryKey: "Home-003", routerState: "/page3"},
        {entryKey: "Inbox-002", routerState: "/page5"},
        {entryKey: "Inbox-003", routerState: "/page6"},
    ]);

    await history.switchTabFromExternal("Create", new URL("/create", window.location.href));

    expect(createPath(window.location)).toEqual("/create");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/create");
    expect(history.getEntryKey()).toEqual("Create-000");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Search-001", routerState: "/page8"},
        {entryKey: "Search-002", routerState: "/page9"},
        {entryKey: "Search-003", routerState: "/page10"},
        {entryKey: "Home-003", routerState: "/page3"},
        {entryKey: "Inbox-002", routerState: "/page5"},
        {entryKey: "Inbox-003", routerState: "/page6"},
        {entryKey: "Inbox-004", routerState: "/page7"},
    ]);

    await history.switchTabFromExternal("Home", new URL("/page3", window.location.href));

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.getEntryKey()).toEqual("Home-003");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Search-001", routerState: "/page8"},
        {entryKey: "Search-002", routerState: "/page9"},
        {entryKey: "Search-003", routerState: "/page10"},
        {entryKey: "Inbox-002", routerState: "/page5"},
        {entryKey: "Inbox-003", routerState: "/page6"},
        {entryKey: "Inbox-004", routerState: "/page7"},
        {entryKey: "Create-000", routerState: "/create"},
    ]);
});

test("can switch tabs with expected path", async () => {
    const {history, router} = createHistory();

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.getEntryKey()).toEqual("Home-000");
    expect(history.getInertRouterStates()).toEqual([]);

    history.push("/page1");
    router.state = "/page1";

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.getEntryKey()).toEqual("Home-001");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-000", routerState: "/home"}]);

    history.push("/page2");
    router.state = "/page2";

    expect(createPath(window.location)).toEqual("/page2");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page2");
    expect(history.getEntryKey()).toEqual("Home-002");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
    ]);

    history.push("/page3");
    router.state = "/page3";

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.getEntryKey()).toEqual("Home-003");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
    ]);

    await history.switchTabFromExternal("Inbox", new URL("/inbox", window.location.href));

    expect(createPath(window.location)).toEqual("/inbox");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/inbox");
    expect(history.getEntryKey()).toEqual("Inbox-000");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Home-003", routerState: "/page3"},
    ]);

    history.push("/page4");
    router.state = "/page4";

    expect(createPath(window.location)).toEqual("/page4");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page4");
    expect(history.getEntryKey()).toEqual("Inbox-001");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Home-003", routerState: "/page3"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
    ]);

    history.push("/page5");
    router.state = "/page5";

    expect(createPath(window.location)).toEqual("/page5");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page5");
    expect(history.getEntryKey()).toEqual("Inbox-002");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Home-003", routerState: "/page3"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page4"},
    ]);

    history.push("/page6");
    router.state = "/page6";

    expect(createPath(window.location)).toEqual("/page6");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page6");
    expect(history.getEntryKey()).toEqual("Inbox-003");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Home-003", routerState: "/page3"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page4"},
        {entryKey: "Inbox-002", routerState: "/page5"},
    ]);

    history.push("/page7");
    router.state = "/page7";

    expect(createPath(window.location)).toEqual("/page7");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page7");
    expect(history.getEntryKey()).toEqual("Inbox-004");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Home-003", routerState: "/page3"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page4"},
        {entryKey: "Inbox-002", routerState: "/page5"},
        {entryKey: "Inbox-003", routerState: "/page6"},
    ]);

    await history.switchTabFromExternal("Home", new URL("/page3", window.location.href));

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.getEntryKey()).toEqual("Home-003");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page4"},
        {entryKey: "Inbox-002", routerState: "/page5"},
        {entryKey: "Inbox-003", routerState: "/page6"},
        {entryKey: "Inbox-004", routerState: "/page7"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
    ]);

    await history.switchTabFromExternal("Inbox", new URL("/page6", window.location.href));

    expect(createPath(window.location)).toEqual("/page6");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page6");
    expect(history.getEntryKey()).toEqual("Inbox-000");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Home-003", routerState: "/page3"},
    ]);
});

test("can pop", async () => {
    const {history, router} = createHistory();

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.getEntryKey()).toEqual("Home-000");
    expect(history.getInertRouterStates()).toEqual([]);

    history.push("/page1");
    router.state = "/page1";

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.getEntryKey()).toEqual("Home-001");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-000", routerState: "/home"}]);

    history.push("/page2");
    router.state = "/page2";

    expect(createPath(window.location)).toEqual("/page2");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page2");
    expect(history.getEntryKey()).toEqual("Home-002");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
    ]);

    history.push("/page3");
    router.state = "/page3";

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.getEntryKey()).toEqual("Home-003");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
    ]);

    history.go(-1);

    expect(createPath(window.location)).toEqual("/page2");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page2");
    expect(history.getEntryKey()).toEqual("Home-002");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
    ]);

    history.go(-1);

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.getEntryKey()).toEqual("Home-001");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-000", routerState: "/home"}]);

    // noop
    history.go(1);

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.getEntryKey()).toEqual("Home-001");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-000", routerState: "/home"}]);

    // noop
    history.go(2);

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.getEntryKey()).toEqual("Home-001");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-000", routerState: "/home"}]);

    history.push("/page4");
    router.state = "/page4";

    history.push("/page5");
    router.state = "/page5";

    history.push("/page6");
    router.state = "/page6";

    history.push("/page7");
    router.state = "/page7";

    history.push("/page8");
    router.state = "/page8";

    history.push("/page9");
    router.state = "/page9";

    expect(createPath(window.location)).toEqual("/page9");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page9");
    expect(history.getEntryKey()).toEqual("Home-007");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page4"},
        {entryKey: "Home-003", routerState: "/page5"},
        {entryKey: "Home-004", routerState: "/page6"},
        {entryKey: "Home-005", routerState: "/page7"},
        {entryKey: "Home-006", routerState: "/page8"},
    ]);

    history.push("/page10");
    router.state = "/page10";

    expect(createPath(window.location)).toEqual("/page10");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page10");
    expect(history.getEntryKey()).toEqual("Home-008");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page4"},
        {entryKey: "Home-003", routerState: "/page5"},
        {entryKey: "Home-004", routerState: "/page6"},
        {entryKey: "Home-005", routerState: "/page7"},
        {entryKey: "Home-006", routerState: "/page8"},
        {entryKey: "Home-007", routerState: "/page9"},
    ]);

    history.push("/page11");
    router.state = "/page11";

    expect(createPath(window.location)).toEqual("/page11");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page11");
    expect(history.getEntryKey()).toEqual("Home-009");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-002", routerState: "/page4"},
        {entryKey: "Home-003", routerState: "/page5"},
        {entryKey: "Home-004", routerState: "/page6"},
        {entryKey: "Home-005", routerState: "/page7"},
        {entryKey: "Home-006", routerState: "/page8"},
        {entryKey: "Home-007", routerState: "/page9"},
        {entryKey: "Home-008", routerState: "/page10"},
    ]);

    history.go(-1);

    expect(createPath(window.location)).toEqual("/page10");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page10");
    expect(history.getEntryKey()).toEqual("Home-008");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-002", routerState: "/page4"},
        {entryKey: "Home-003", routerState: "/page5"},
        {entryKey: "Home-004", routerState: "/page6"},
        {entryKey: "Home-005", routerState: "/page7"},
        {entryKey: "Home-006", routerState: "/page8"},
        {entryKey: "Home-007", routerState: "/page9"},
    ]);

    history.go(-2);

    expect(createPath(window.location)).toEqual("/page8");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page8");
    expect(history.getEntryKey()).toEqual("Home-006");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-002", routerState: "/page4"},
        {entryKey: "Home-003", routerState: "/page5"},
        {entryKey: "Home-004", routerState: "/page6"},
        {entryKey: "Home-005", routerState: "/page7"},
    ]);

    history.push("/page12");
    router.state = "/page12";

    expect(createPath(window.location)).toEqual("/page12");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page12");
    expect(history.getEntryKey()).toEqual("Home-007");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-002", routerState: "/page4"},
        {entryKey: "Home-003", routerState: "/page5"},
        {entryKey: "Home-004", routerState: "/page6"},
        {entryKey: "Home-005", routerState: "/page7"},
        {entryKey: "Home-006", routerState: "/page8"},
    ]);

    history.push("/page13");
    router.state = "/page13";

    expect(createPath(window.location)).toEqual("/page13");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page13");
    expect(history.getEntryKey()).toEqual("Home-008");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-002", routerState: "/page4"},
        {entryKey: "Home-003", routerState: "/page5"},
        {entryKey: "Home-004", routerState: "/page6"},
        {entryKey: "Home-005", routerState: "/page7"},
        {entryKey: "Home-006", routerState: "/page8"},
        {entryKey: "Home-007", routerState: "/page12"},
    ]);

    history.go(-4);

    expect(createPath(window.location)).toEqual("/page6");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page6");
    expect(history.getEntryKey()).toEqual("Home-004");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-002", routerState: "/page4"},
        {entryKey: "Home-003", routerState: "/page5"},
    ]);

    history.go(-1);

    expect(createPath(window.location)).toEqual("/page5");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page5");
    expect(history.getEntryKey()).toEqual("Home-003");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-002", routerState: "/page4"}]);

    history.go(-1);

    expect(createPath(window.location)).toEqual("/page4");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page4");
    expect(history.getEntryKey()).toEqual("Home-002");
    expect(history.getInertRouterStates()).toEqual([]);

    history.go(-1);

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.getEntryKey()).toEqual("Home-001");
    expect(history.getInertRouterStates()).toEqual([]);

    history.go(-1);

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.getEntryKey()).toEqual("Home-000");
    expect(history.getInertRouterStates()).toEqual([]);
});

test("can pop even when there are no past entries", async () => {
    const {history, router} = createHistory();

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.getEntryKey()).toEqual("Home-000");
    expect(history.getInertRouterStates()).toEqual([]);

    expectNavigationRequestEventualExternalPopCount(0);

    history.go(-1);

    expectNavigationRequestEventualExternalPopCount(1);

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.getEntryKey()).toEqual("Home-000");
    expect(history.getInertRouterStates()).toEqual([]);

    history.push("/page1");
    router.state = "/page1";

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.getEntryKey()).toEqual("Home-001");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-000", routerState: "/home"}]);

    history.push("/page2");
    router.state = "/page2";

    expect(createPath(window.location)).toEqual("/page2");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page2");
    expect(history.getEntryKey()).toEqual("Home-002");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
    ]);

    expectNavigationRequestEventualExternalPopCount(0);

    history.go(-1);

    expectNavigationRequestEventualExternalPopCount(0);

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.getEntryKey()).toEqual("Home-001");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-000", routerState: "/home"}]);

    expectNavigationRequestEventualExternalPopCount(0);

    history.go(-1);

    expectNavigationRequestEventualExternalPopCount(0);

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.getEntryKey()).toEqual("Home-000");
    expect(history.getInertRouterStates()).toEqual([]);

    expectNavigationRequestEventualExternalPopCount(0);

    history.go(-1);

    expectNavigationRequestEventualExternalPopCount(1);

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.getEntryKey()).toEqual("Home-000");
    expect(history.getInertRouterStates()).toEqual([]);

    history.push("/page3");
    router.state = "/page3";

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.getEntryKey()).toEqual("Home-001");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-000", routerState: "/home"}]);

    history.push("/page4");
    router.state = "/page4";

    expect(createPath(window.location)).toEqual("/page4");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page4");
    expect(history.getEntryKey()).toEqual("Home-002");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page3"},
    ]);

    expectNavigationRequestEventualExternalPopCount(0);

    history.go(-100);

    expectNavigationRequestEventualExternalPopCount(0);

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.getEntryKey()).toEqual("Home-000");
    expect(history.getInertRouterStates()).toEqual([]);

    expectNavigationRequestEventualExternalPopCount(0);

    history.go(-100);

    expectNavigationRequestEventualExternalPopCount(1);

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.getEntryKey()).toEqual("Home-000");
    expect(history.getInertRouterStates()).toEqual([]);
});

test("can pop across switched tabs", async () => {
    const {history, router} = createHistory();

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.getEntryKey()).toEqual("Home-000");
    expect(history.getInertRouterStates()).toEqual([]);

    history.push("/page1");
    router.state = "/page1";

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.getEntryKey()).toEqual("Home-001");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-000", routerState: "/home"}]);

    history.push("/page2");
    router.state = "/page2";

    expect(createPath(window.location)).toEqual("/page2");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page2");
    expect(history.getEntryKey()).toEqual("Home-002");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
    ]);

    await history.switchTabFromExternal("Inbox", new URL("/inbox", window.location.href));

    expect(createPath(window.location)).toEqual("/inbox");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/inbox");
    expect(history.getEntryKey()).toEqual("Inbox-000");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
    ]);

    history.push("/page3");
    router.state = "/page3";

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.getEntryKey()).toEqual("Inbox-001");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
    ]);

    history.push("/page4");
    router.state = "/page4";

    expect(createPath(window.location)).toEqual("/page4");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page4");
    expect(history.getEntryKey()).toEqual("Inbox-002");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page3"},
    ]);

    history.push("/page5");
    router.state = "/page5";

    expect(createPath(window.location)).toEqual("/page5");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page5");
    expect(history.getEntryKey()).toEqual("Inbox-003");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page3"},
        {entryKey: "Inbox-002", routerState: "/page4"},
    ]);

    history.push("/page6");
    router.state = "/page6";

    expect(createPath(window.location)).toEqual("/page6");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page6");
    expect(history.getEntryKey()).toEqual("Inbox-004");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page3"},
        {entryKey: "Inbox-002", routerState: "/page4"},
        {entryKey: "Inbox-003", routerState: "/page5"},
    ]);

    history.go(-1);

    expect(createPath(window.location)).toEqual("/page5");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page5");
    expect(history.getEntryKey()).toEqual("Inbox-003");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page3"},
        {entryKey: "Inbox-002", routerState: "/page4"},
    ]);

    await history.switchTabFromExternal("Home", new URL("/page2", window.location.href));

    expect(createPath(window.location)).toEqual("/page2");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page2");
    expect(history.getEntryKey()).toEqual("Home-002");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page3"},
        {entryKey: "Inbox-002", routerState: "/page4"},
        {entryKey: "Inbox-003", routerState: "/page5"},
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
    ]);

    history.go(-1);

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.getEntryKey()).toEqual("Home-001");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page3"},
        {entryKey: "Inbox-002", routerState: "/page4"},
        {entryKey: "Inbox-003", routerState: "/page5"},
        {entryKey: "Home-000", routerState: "/home"},
    ]);

    await history.switchTabFromExternal("Create", new URL("/create", window.location.href));

    expect(createPath(window.location)).toEqual("/create");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/create");
    expect(history.getEntryKey()).toEqual("Create-000");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page3"},
        {entryKey: "Inbox-002", routerState: "/page4"},
        {entryKey: "Inbox-003", routerState: "/page5"},
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
    ]);

    expectNavigationRequestEventualExternalPopCount(0);

    history.go(-1);

    expectNavigationRequestEventualExternalPopCount(1);

    expect(createPath(window.location)).toEqual("/create");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/create");
    expect(history.getEntryKey()).toEqual("Create-000");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page3"},
        {entryKey: "Inbox-002", routerState: "/page4"},
        {entryKey: "Inbox-003", routerState: "/page5"},
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
    ]);

    await history.switchTabFromExternal("Inbox", new URL("/page5", window.location.href));

    expect(createPath(window.location)).toEqual("/page5");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page5");
    expect(history.getEntryKey()).toEqual("Inbox-003");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Create-000", routerState: "/create"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page3"},
        {entryKey: "Inbox-002", routerState: "/page4"},
    ]);

    history.go(-2);

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.getEntryKey()).toEqual("Inbox-001");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Create-000", routerState: "/create"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
    ]);

    history.push("/page7");
    router.state = "/page7";

    expect(createPath(window.location)).toEqual("/page7");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page7");
    expect(history.getEntryKey()).toEqual("Inbox-002");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Create-000", routerState: "/create"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page3"},
    ]);

    history.push("/page8");
    router.state = "/page8";

    expect(createPath(window.location)).toEqual("/page8");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page8");
    expect(history.getEntryKey()).toEqual("Inbox-003");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Create-000", routerState: "/create"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page3"},
        {entryKey: "Inbox-002", routerState: "/page7"},
    ]);

    history.push("/page9");
    router.state = "/page9";

    expect(createPath(window.location)).toEqual("/page9");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page9");
    expect(history.getEntryKey()).toEqual("Inbox-004");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Create-000", routerState: "/create"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page3"},
        {entryKey: "Inbox-002", routerState: "/page7"},
        {entryKey: "Inbox-003", routerState: "/page8"},
    ]);

    history.push("/page10");
    router.state = "/page10";

    expect(createPath(window.location)).toEqual("/page10");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page10");
    expect(history.getEntryKey()).toEqual("Inbox-005");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Create-000", routerState: "/create"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page3"},
        {entryKey: "Inbox-002", routerState: "/page7"},
        {entryKey: "Inbox-003", routerState: "/page8"},
        {entryKey: "Inbox-004", routerState: "/page9"},
    ]);

    await history.switchTabFromExternal("Home", new URL("/page1", window.location.href));

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.getEntryKey()).toEqual("Home-001");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Create-000", routerState: "/create"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page3"},
        {entryKey: "Inbox-002", routerState: "/page7"},
        {entryKey: "Inbox-003", routerState: "/page8"},
        {entryKey: "Inbox-004", routerState: "/page9"},
        {entryKey: "Inbox-005", routerState: "/page10"},
    ]);

    history.go(-1);

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.getEntryKey()).toEqual("Home-000");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Create-000", routerState: "/create"},
        {entryKey: "Inbox-000", routerState: "/inbox"},
        {entryKey: "Inbox-001", routerState: "/page3"},
        {entryKey: "Inbox-002", routerState: "/page7"},
        {entryKey: "Inbox-003", routerState: "/page8"},
        {entryKey: "Inbox-004", routerState: "/page9"},
        {entryKey: "Inbox-005", routerState: "/page10"},
    ]);
});

test("can pop with expected path", async () => {
    const {history, router} = createHistory();

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.getEntryKey()).toEqual("Home-000");
    expect(history.getInertRouterStates()).toEqual([]);

    history.goFromExternal(-1, new URL("/page1", window.location.href));

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.getEntryKey()).toEqual("Home-000");
    expect(history.getInertRouterStates()).toEqual([]);

    history.push("/page2");
    router.state = "/page2";

    expect(createPath(window.location)).toEqual("/page2");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page2");
    expect(history.getEntryKey()).toEqual("Home-001");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-000", routerState: "/page1"}]);

    history.push("/page3");
    router.state = "/page3";

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.getEntryKey()).toEqual("Home-002");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/page1"},
        {entryKey: "Home-001", routerState: "/page2"},
    ]);

    history.push("/page4");
    router.state = "/page4";

    expect(createPath(window.location)).toEqual("/page4");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page4");
    expect(history.getEntryKey()).toEqual("Home-003");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/page1"},
        {entryKey: "Home-001", routerState: "/page2"},
        {entryKey: "Home-002", routerState: "/page3"},
    ]);

    history.goFromExternal(-1, new URL("/page3", window.location.href));

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.getEntryKey()).toEqual("Home-002");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/page1"},
        {entryKey: "Home-001", routerState: "/page2"},
    ]);

    history.goFromExternal(-1, new URL("/page5", window.location.href));

    expect(createPath(window.location)).toEqual("/page5");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page5");
    expect(history.getEntryKey()).toEqual("Home-000");
    expect(history.getInertRouterStates()).toEqual([]);

    history.push("/page6");
    router.state = "/page6";

    expect(createPath(window.location)).toEqual("/page6");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page6");
    expect(history.getEntryKey()).toEqual("Home-001");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-000", routerState: "/page5"}]);

    history.push("/page7");
    router.state = "/page7";

    expect(createPath(window.location)).toEqual("/page7");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page7");
    expect(history.getEntryKey()).toEqual("Home-002");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/page5"},
        {entryKey: "Home-001", routerState: "/page6"},
    ]);

    await history.switchTabFromExternal("More", new URL("/more", window.location.href));

    expect(createPath(window.location)).toEqual("/more");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/more");
    expect(history.getEntryKey()).toEqual("More-000");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/page5"},
        {entryKey: "Home-001", routerState: "/page6"},
        {entryKey: "Home-002", routerState: "/page7"},
    ]);

    history.push("/page8");
    router.state = "/page8";

    expect(createPath(window.location)).toEqual("/page8");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page8");
    expect(history.getEntryKey()).toEqual("More-001");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/page5"},
        {entryKey: "Home-001", routerState: "/page6"},
        {entryKey: "Home-002", routerState: "/page7"},
        {entryKey: "More-000", routerState: "/more"},
    ]);

    history.goFromExternal(-100, new URL("/page9", window.location.href));

    expect(createPath(window.location)).toEqual("/page9");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page9");
    expect(history.getEntryKey()).toEqual("More-000");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/page5"},
        {entryKey: "Home-001", routerState: "/page6"},
        {entryKey: "Home-002", routerState: "/page7"},
    ]);

    history.push("/page10");
    router.state = "/page10";

    expect(createPath(window.location)).toEqual("/page10");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page10");
    expect(history.getEntryKey()).toEqual("More-001");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/page5"},
        {entryKey: "Home-001", routerState: "/page6"},
        {entryKey: "Home-002", routerState: "/page7"},
        {entryKey: "More-000", routerState: "/page9"},
    ]);

    history.push("/page11");
    router.state = "/page11";

    expect(createPath(window.location)).toEqual("/page11");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page11");
    expect(history.getEntryKey()).toEqual("More-002");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/page5"},
        {entryKey: "Home-001", routerState: "/page6"},
        {entryKey: "Home-002", routerState: "/page7"},
        {entryKey: "More-000", routerState: "/page9"},
        {entryKey: "More-001", routerState: "/page10"},
    ]);

    history.push("/page12");
    router.state = "/page12";

    expect(createPath(window.location)).toEqual("/page12");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page12");
    expect(history.getEntryKey()).toEqual("More-003");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/page5"},
        {entryKey: "Home-001", routerState: "/page6"},
        {entryKey: "Home-002", routerState: "/page7"},
        {entryKey: "More-000", routerState: "/page9"},
        {entryKey: "More-001", routerState: "/page10"},
        {entryKey: "More-002", routerState: "/page11"},
    ]);

    history.push("/page13");
    router.state = "/page13";

    expect(createPath(window.location)).toEqual("/page13");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page13");
    expect(history.getEntryKey()).toEqual("More-004");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/page5"},
        {entryKey: "Home-001", routerState: "/page6"},
        {entryKey: "Home-002", routerState: "/page7"},
        {entryKey: "More-000", routerState: "/page9"},
        {entryKey: "More-001", routerState: "/page10"},
        {entryKey: "More-002", routerState: "/page11"},
        {entryKey: "More-003", routerState: "/page12"},
    ]);

    history.goFromExternal(-1, new URL("/page12", window.location.href));

    expect(createPath(window.location)).toEqual("/page12");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page12");
    expect(history.getEntryKey()).toEqual("More-003");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/page5"},
        {entryKey: "Home-001", routerState: "/page6"},
        {entryKey: "Home-002", routerState: "/page7"},
        {entryKey: "More-000", routerState: "/page9"},
        {entryKey: "More-001", routerState: "/page10"},
        {entryKey: "More-002", routerState: "/page11"},
    ]);

    history.goFromExternal(-1, new URL("/page14", window.location.href));

    expect(createPath(window.location)).toEqual("/page14");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page14");
    expect(history.getEntryKey()).toEqual("More-000");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/page5"},
        {entryKey: "Home-001", routerState: "/page6"},
        {entryKey: "Home-002", routerState: "/page7"},
    ]);
});

test("can push with a different tab", async () => {
    const {history, router} = createHistory();

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.getEntryKey()).toEqual("Home-000");
    expect(history.getInertRouterStates()).toEqual([]);

    history.push("/page1");
    router.state = "/page1";

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.getEntryKey()).toEqual("Home-001");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-000", routerState: "/home"}]);

    history.push("/page2");
    router.state = "/page2";

    expect(createPath(window.location)).toEqual("/page2");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page2");
    expect(history.getEntryKey()).toEqual("Home-002");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
    ]);

    history.push("/page3", {tab: "Inbox", isTabSwitch: true});
    router.state = "/page3";

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.getEntryKey()).toEqual("Inbox-000");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
    ]);

    history.push("/page4");
    router.state = "/page4";

    expect(createPath(window.location)).toEqual("/page4");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page4");
    expect(history.getEntryKey()).toEqual("Inbox-001");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Inbox-000", routerState: "/page3"},
    ]);

    await history.switchTabFromExternal("Create", new URL("/create", window.location.href));

    expect(createPath(window.location)).toEqual("/create");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/create");
    expect(history.getEntryKey()).toEqual("Create-000");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Inbox-000", routerState: "/page3"},
        {entryKey: "Inbox-001", routerState: "/page4"},
    ]);

    history.push("/page5", {tab: "Inbox", isTabSwitch: true});
    router.state = "/page5";

    expect(createPath(window.location)).toEqual("/page5");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page5");
    expect(history.getEntryKey()).toEqual("Inbox-002");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Create-000", routerState: "/create"},
        {entryKey: "Inbox-000", routerState: "/page3"},
        {entryKey: "Inbox-001", routerState: "/page4"},
    ]);

    history.push("/page6");
    router.state = "/page6";

    expect(createPath(window.location)).toEqual("/page6");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page6");
    expect(history.getEntryKey()).toEqual("Inbox-003");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-000", routerState: "/home"},
        {entryKey: "Home-001", routerState: "/page1"},
        {entryKey: "Home-002", routerState: "/page2"},
        {entryKey: "Create-000", routerState: "/create"},
        {entryKey: "Inbox-000", routerState: "/page3"},
        {entryKey: "Inbox-001", routerState: "/page4"},
        {entryKey: "Inbox-002", routerState: "/page5"},
    ]);
});
