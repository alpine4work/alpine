// We need to import this first so the test native mobile bridge is properly
// initialized.
//
// eslint-disable-next-line import/no-duplicates
import "~/client/remix/register_native_mobile_bridge_for_test.js";

import {Action, Location} from "@remix-run/router";
import {createPath} from "react-router";
import {NativeMobileMemoryHistory} from "~/app/router/native_mobile_router.js";
// eslint-disable-next-line import/no-duplicates
import {NativeMobileBridgeForTest} from "~/client/remix/register_native_mobile_bridge_for_test.js";
import {assert} from "~/shared/helpers/control/assert.js";

beforeEach(() => {
    history.replaceState(null, "", "/home");
});

let navigationRequestExternalPopCount = 0;

NativeMobileBridgeForTest.navigation.subscribeToRequestExternalPopForTest(() => {
    navigationRequestExternalPopCount += 1;
});

beforeEach(() => {
    navigationRequestExternalPopCount = 0;
});

afterEach(() => {
    assert(
        navigationRequestExternalPopCount === 0,
        "Non-zero `navigationRequestExternalPopCount` at the end of test, should call `expectNavigationRequestExternalPopCount()`",
    );
});

function expectNavigationRequestExternalPopCount(count: number) {
    expect(navigationRequestExternalPopCount).toEqual(count);
    navigationRequestExternalPopCount = 0;
}

function createHistory() {
    const history = new NativeMobileMemoryHistory();

    const router: {
        state: string;
        unstable_unsafelyRestoreNavigation: (options: {location: Location}) => void;
    } = {
        state: createPath(window.location),
        unstable_unsafelyRestoreNavigation: ({location}: {location: Location}) => {
            router.state = createPath(location);
        },
    };

    history.initializeRouter(router as any);

    history.listen(({location}) => {
        router.state = createPath(location);
    });

    return {history, router};
}

test("history starts at `window.location`", () => {
    const {history} = createHistory();

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.entryKey).toEqual("Home-0");
    expect(history.getInertRouterStates()).toEqual([]);
});

test("can push", () => {
    const {history, router} = createHistory();

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.entryKey).toEqual("Home-0");
    expect(history.getInertRouterStates()).toEqual([]);

    history.push("/page1");
    router.state = "/page1";

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.entryKey).toEqual("Home-1");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-0", routerState: "/home"}]);

    history.push("/page2");
    router.state = "/page2";

    expect(createPath(window.location)).toEqual("/page2");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page2");
    expect(history.entryKey).toEqual("Home-2");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
    ]);

    history.push("/page3");
    router.state = "/page3";

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.entryKey).toEqual("Home-3");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page2"},
    ]);

    history.push("/page4");
    router.state = "/page4";

    expect(createPath(window.location)).toEqual("/page4");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page4");
    expect(history.entryKey).toEqual("Home-4");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page2"},
        {entryKey: "Home-3", routerState: "/page3"},
    ]);

    history.push("/page5");
    router.state = "/page5";

    expect(createPath(window.location)).toEqual("/page5");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page5");
    expect(history.entryKey).toEqual("Home-5");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page2"},
        {entryKey: "Home-3", routerState: "/page3"},
        {entryKey: "Home-4", routerState: "/page4"},
    ]);

    history.push("/page6");
    router.state = "/page6";

    expect(createPath(window.location)).toEqual("/page6");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page6");
    expect(history.entryKey).toEqual("Home-6");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page2"},
        {entryKey: "Home-3", routerState: "/page3"},
        {entryKey: "Home-4", routerState: "/page4"},
        {entryKey: "Home-5", routerState: "/page5"},
    ]);

    history.push("/page7");
    router.state = "/page7";

    expect(createPath(window.location)).toEqual("/page7");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page7");
    expect(history.entryKey).toEqual("Home-7");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page2"},
        {entryKey: "Home-3", routerState: "/page3"},
        {entryKey: "Home-4", routerState: "/page4"},
        {entryKey: "Home-5", routerState: "/page5"},
        {entryKey: "Home-6", routerState: "/page6"},
    ]);

    history.push("/page8");
    router.state = "/page8";

    expect(createPath(window.location)).toEqual("/page8");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page8");
    expect(history.entryKey).toEqual("Home-8");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page2"},
        {entryKey: "Home-3", routerState: "/page3"},
        {entryKey: "Home-4", routerState: "/page4"},
        {entryKey: "Home-5", routerState: "/page5"},
        {entryKey: "Home-6", routerState: "/page6"},
        {entryKey: "Home-7", routerState: "/page7"},
    ]);

    history.push("/page9");
    router.state = "/page9";

    expect(createPath(window.location)).toEqual("/page9");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page9");
    expect(history.entryKey).toEqual("Home-9");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-2", routerState: "/page2"},
        {entryKey: "Home-3", routerState: "/page3"},
        {entryKey: "Home-4", routerState: "/page4"},
        {entryKey: "Home-5", routerState: "/page5"},
        {entryKey: "Home-6", routerState: "/page6"},
        {entryKey: "Home-7", routerState: "/page7"},
        {entryKey: "Home-8", routerState: "/page8"},
    ]);
});

test("can switch tabs", () => {
    const {history, router} = createHistory();

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.entryKey).toEqual("Home-0");
    expect(history.getInertRouterStates()).toEqual([]);

    history.push("/page1");
    router.state = "/page1";

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.entryKey).toEqual("Home-1");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-0", routerState: "/home"}]);

    history.push("/page2");
    router.state = "/page2";

    expect(createPath(window.location)).toEqual("/page2");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page2");
    expect(history.entryKey).toEqual("Home-2");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
    ]);

    history.push("/page3");
    router.state = "/page3";

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.entryKey).toEqual("Home-3");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page2"},
    ]);

    history.switchTab("Inbox");

    expect(createPath(window.location)).toEqual("/inbox");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/inbox");
    expect(history.entryKey).toEqual("Inbox-0");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page2"},
        {entryKey: "Home-3", routerState: "/page3"},
    ]);

    history.push("/page4");
    router.state = "/page4";

    expect(createPath(window.location)).toEqual("/page4");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page4");
    expect(history.entryKey).toEqual("Inbox-1");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page2"},
        {entryKey: "Home-3", routerState: "/page3"},
        {entryKey: "Inbox-0", routerState: "/inbox"},
    ]);

    history.push("/page5");
    router.state = "/page5";

    expect(createPath(window.location)).toEqual("/page5");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page5");
    expect(history.entryKey).toEqual("Inbox-2");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page2"},
        {entryKey: "Home-3", routerState: "/page3"},
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page4"},
    ]);

    history.push("/page6");
    router.state = "/page6";

    expect(createPath(window.location)).toEqual("/page6");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page6");
    expect(history.entryKey).toEqual("Inbox-3");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page2"},
        {entryKey: "Home-3", routerState: "/page3"},
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page4"},
        {entryKey: "Inbox-2", routerState: "/page5"},
    ]);

    history.push("/page7");
    router.state = "/page7";

    expect(createPath(window.location)).toEqual("/page7");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page7");
    expect(history.entryKey).toEqual("Inbox-4");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page2"},
        {entryKey: "Home-3", routerState: "/page3"},
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page4"},
        {entryKey: "Inbox-2", routerState: "/page5"},
        {entryKey: "Inbox-3", routerState: "/page6"},
    ]);

    history.switchTab("Search");

    expect(createPath(window.location)).toEqual("/search");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/search");
    expect(history.entryKey).toEqual("Search-0");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-2", routerState: "/page2"},
        {entryKey: "Home-3", routerState: "/page3"},
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page4"},
        {entryKey: "Inbox-2", routerState: "/page5"},
        {entryKey: "Inbox-3", routerState: "/page6"},
        {entryKey: "Inbox-4", routerState: "/page7"},
    ]);

    history.push("/page8");
    router.state = "/page8";

    expect(createPath(window.location)).toEqual("/page8");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page8");
    expect(history.entryKey).toEqual("Search-1");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-3", routerState: "/page3"},
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page4"},
        {entryKey: "Inbox-2", routerState: "/page5"},
        {entryKey: "Inbox-3", routerState: "/page6"},
        {entryKey: "Inbox-4", routerState: "/page7"},
        {entryKey: "Search-0", routerState: "/search"},
    ]);

    history.push("/page9");
    router.state = "/page9";

    expect(createPath(window.location)).toEqual("/page9");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page9");
    expect(history.entryKey).toEqual("Search-2");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page4"},
        {entryKey: "Inbox-2", routerState: "/page5"},
        {entryKey: "Inbox-3", routerState: "/page6"},
        {entryKey: "Inbox-4", routerState: "/page7"},
        {entryKey: "Search-0", routerState: "/search"},
        {entryKey: "Search-1", routerState: "/page8"},
    ]);

    history.push("/page10");
    router.state = "/page10";

    expect(createPath(window.location)).toEqual("/page10");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page10");
    expect(history.entryKey).toEqual("Search-3");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Inbox-1", routerState: "/page4"},
        {entryKey: "Inbox-2", routerState: "/page5"},
        {entryKey: "Inbox-3", routerState: "/page6"},
        {entryKey: "Inbox-4", routerState: "/page7"},
        {entryKey: "Search-0", routerState: "/search"},
        {entryKey: "Search-1", routerState: "/page8"},
        {entryKey: "Search-2", routerState: "/page9"},
    ]);

    history.switchTab("Home");

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.entryKey).toEqual("Home-3");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Inbox-2", routerState: "/page5"},
        {entryKey: "Inbox-3", routerState: "/page6"},
        {entryKey: "Inbox-4", routerState: "/page7"},
        {entryKey: "Search-0", routerState: "/search"},
        {entryKey: "Search-1", routerState: "/page8"},
        {entryKey: "Search-2", routerState: "/page9"},
        {entryKey: "Search-3", routerState: "/page10"},
    ]);

    history.switchTab("Inbox");

    expect(createPath(window.location)).toEqual("/page7");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page7");
    expect(history.entryKey).toEqual("Inbox-4");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Search-0", routerState: "/search"},
        {entryKey: "Search-1", routerState: "/page8"},
        {entryKey: "Search-2", routerState: "/page9"},
        {entryKey: "Search-3", routerState: "/page10"},
        {entryKey: "Home-3", routerState: "/page3"},
        {entryKey: "Inbox-2", routerState: "/page5"},
        {entryKey: "Inbox-3", routerState: "/page6"},
    ]);

    history.switchTab("Create");

    expect(createPath(window.location)).toEqual("/create");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/create");
    expect(history.entryKey).toEqual("Create-0");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Search-1", routerState: "/page8"},
        {entryKey: "Search-2", routerState: "/page9"},
        {entryKey: "Search-3", routerState: "/page10"},
        {entryKey: "Home-3", routerState: "/page3"},
        {entryKey: "Inbox-2", routerState: "/page5"},
        {entryKey: "Inbox-3", routerState: "/page6"},
        {entryKey: "Inbox-4", routerState: "/page7"},
    ]);

    history.switchTab("Home");

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.entryKey).toEqual("Home-3");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Search-1", routerState: "/page8"},
        {entryKey: "Search-2", routerState: "/page9"},
        {entryKey: "Search-3", routerState: "/page10"},
        {entryKey: "Inbox-2", routerState: "/page5"},
        {entryKey: "Inbox-3", routerState: "/page6"},
        {entryKey: "Inbox-4", routerState: "/page7"},
        {entryKey: "Create-0", routerState: "/create"},
    ]);
});

test("can pop", () => {
    const {history, router} = createHistory();

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.entryKey).toEqual("Home-0");
    expect(history.getInertRouterStates()).toEqual([]);

    history.push("/page1");
    router.state = "/page1";

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.entryKey).toEqual("Home-1");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-0", routerState: "/home"}]);

    history.push("/page2");
    router.state = "/page2";

    expect(createPath(window.location)).toEqual("/page2");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page2");
    expect(history.entryKey).toEqual("Home-2");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
    ]);

    history.push("/page3");
    router.state = "/page3";

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.entryKey).toEqual("Home-3");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page2"},
    ]);

    history.go(-1);

    expect(createPath(window.location)).toEqual("/page2");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page2");
    expect(history.entryKey).toEqual("Home-2");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
    ]);

    history.go(-1);

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.entryKey).toEqual("Home-1");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-0", routerState: "/home"}]);

    // noop
    history.go(1);

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.entryKey).toEqual("Home-1");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-0", routerState: "/home"}]);

    // noop
    history.go(2);

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.entryKey).toEqual("Home-1");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-0", routerState: "/home"}]);

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
    expect(history.entryKey).toEqual("Home-7");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page4"},
        {entryKey: "Home-3", routerState: "/page5"},
        {entryKey: "Home-4", routerState: "/page6"},
        {entryKey: "Home-5", routerState: "/page7"},
        {entryKey: "Home-6", routerState: "/page8"},
    ]);

    history.push("/page10");
    router.state = "/page10";

    expect(createPath(window.location)).toEqual("/page10");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page10");
    expect(history.entryKey).toEqual("Home-8");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page4"},
        {entryKey: "Home-3", routerState: "/page5"},
        {entryKey: "Home-4", routerState: "/page6"},
        {entryKey: "Home-5", routerState: "/page7"},
        {entryKey: "Home-6", routerState: "/page8"},
        {entryKey: "Home-7", routerState: "/page9"},
    ]);

    history.push("/page11");
    router.state = "/page11";

    expect(createPath(window.location)).toEqual("/page11");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page11");
    expect(history.entryKey).toEqual("Home-9");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-2", routerState: "/page4"},
        {entryKey: "Home-3", routerState: "/page5"},
        {entryKey: "Home-4", routerState: "/page6"},
        {entryKey: "Home-5", routerState: "/page7"},
        {entryKey: "Home-6", routerState: "/page8"},
        {entryKey: "Home-7", routerState: "/page9"},
        {entryKey: "Home-8", routerState: "/page10"},
    ]);

    history.go(-1);

    expect(createPath(window.location)).toEqual("/page10");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page10");
    expect(history.entryKey).toEqual("Home-8");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-2", routerState: "/page4"},
        {entryKey: "Home-3", routerState: "/page5"},
        {entryKey: "Home-4", routerState: "/page6"},
        {entryKey: "Home-5", routerState: "/page7"},
        {entryKey: "Home-6", routerState: "/page8"},
        {entryKey: "Home-7", routerState: "/page9"},
    ]);

    history.go(-2);

    expect(createPath(window.location)).toEqual("/page8");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page8");
    expect(history.entryKey).toEqual("Home-6");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-2", routerState: "/page4"},
        {entryKey: "Home-3", routerState: "/page5"},
        {entryKey: "Home-4", routerState: "/page6"},
        {entryKey: "Home-5", routerState: "/page7"},
    ]);

    history.push("/page12");
    router.state = "/page12";

    expect(createPath(window.location)).toEqual("/page12");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page12");
    expect(history.entryKey).toEqual("Home-7");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-2", routerState: "/page4"},
        {entryKey: "Home-3", routerState: "/page5"},
        {entryKey: "Home-4", routerState: "/page6"},
        {entryKey: "Home-5", routerState: "/page7"},
        {entryKey: "Home-6", routerState: "/page8"},
    ]);

    history.push("/page13");
    router.state = "/page13";

    expect(createPath(window.location)).toEqual("/page13");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page13");
    expect(history.entryKey).toEqual("Home-8");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-2", routerState: "/page4"},
        {entryKey: "Home-3", routerState: "/page5"},
        {entryKey: "Home-4", routerState: "/page6"},
        {entryKey: "Home-5", routerState: "/page7"},
        {entryKey: "Home-6", routerState: "/page8"},
        {entryKey: "Home-7", routerState: "/page12"},
    ]);

    history.go(-4);

    expect(createPath(window.location)).toEqual("/page6");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page6");
    expect(history.entryKey).toEqual("Home-4");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-2", routerState: "/page4"},
        {entryKey: "Home-3", routerState: "/page5"},
    ]);

    history.go(-1);

    expect(createPath(window.location)).toEqual("/page5");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page5");
    expect(history.entryKey).toEqual("Home-3");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-2", routerState: "/page4"}]);

    history.go(-1);

    expect(createPath(window.location)).toEqual("/page4");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page4");
    expect(history.entryKey).toEqual("Home-2");
    expect(history.getInertRouterStates()).toEqual([]);

    history.go(-1);

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.entryKey).toEqual("Home-1");
    expect(history.getInertRouterStates()).toEqual([]);

    history.go(-1);

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.entryKey).toEqual("Home-0");
    expect(history.getInertRouterStates()).toEqual([]);
});

test("can pop even when there are no past entries", () => {
    const {history, router} = createHistory();

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.entryKey).toEqual("Home-0");
    expect(history.getInertRouterStates()).toEqual([]);

    expectNavigationRequestExternalPopCount(0);

    history.go(-1);

    expectNavigationRequestExternalPopCount(1);

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.entryKey).toEqual("Home-0");
    expect(history.getInertRouterStates()).toEqual([]);

    history.push("/page1");
    router.state = "/page1";

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.entryKey).toEqual("Home-1");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-0", routerState: "/home"}]);

    history.push("/page2");
    router.state = "/page2";

    expect(createPath(window.location)).toEqual("/page2");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page2");
    expect(history.entryKey).toEqual("Home-2");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
    ]);

    expectNavigationRequestExternalPopCount(0);

    history.go(-1);

    expectNavigationRequestExternalPopCount(0);

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.entryKey).toEqual("Home-1");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-0", routerState: "/home"}]);

    expectNavigationRequestExternalPopCount(0);

    history.go(-1);

    expectNavigationRequestExternalPopCount(0);

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.entryKey).toEqual("Home-0");
    expect(history.getInertRouterStates()).toEqual([]);

    expectNavigationRequestExternalPopCount(0);

    history.go(-1);

    expectNavigationRequestExternalPopCount(1);

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.entryKey).toEqual("Home-0");
    expect(history.getInertRouterStates()).toEqual([]);

    history.push("/page3");
    router.state = "/page3";

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.entryKey).toEqual("Home-1");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-0", routerState: "/home"}]);

    history.push("/page4");
    router.state = "/page4";

    expect(createPath(window.location)).toEqual("/page4");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page4");
    expect(history.entryKey).toEqual("Home-2");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page3"},
    ]);

    expectNavigationRequestExternalPopCount(0);

    history.go(-100);

    expectNavigationRequestExternalPopCount(0);

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.entryKey).toEqual("Home-0");
    expect(history.getInertRouterStates()).toEqual([]);

    expectNavigationRequestExternalPopCount(0);

    history.go(-100);

    expectNavigationRequestExternalPopCount(1);

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.entryKey).toEqual("Home-0");
    expect(history.getInertRouterStates()).toEqual([]);
});

test("can pop across switched tabs", () => {
    const {history, router} = createHistory();

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.entryKey).toEqual("Home-0");
    expect(history.getInertRouterStates()).toEqual([]);

    history.push("/page1");
    router.state = "/page1";

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.entryKey).toEqual("Home-1");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-0", routerState: "/home"}]);

    history.push("/page2");
    router.state = "/page2";

    expect(createPath(window.location)).toEqual("/page2");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page2");
    expect(history.entryKey).toEqual("Home-2");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
    ]);

    history.switchTab("Inbox");

    expect(createPath(window.location)).toEqual("/inbox");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/inbox");
    expect(history.entryKey).toEqual("Inbox-0");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page2"},
    ]);

    history.push("/page3");
    router.state = "/page3";

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.entryKey).toEqual("Inbox-1");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page2"},
        {entryKey: "Inbox-0", routerState: "/inbox"},
    ]);

    history.push("/page4");
    router.state = "/page4";

    expect(createPath(window.location)).toEqual("/page4");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page4");
    expect(history.entryKey).toEqual("Inbox-2");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page2"},
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page3"},
    ]);

    history.push("/page5");
    router.state = "/page5";

    expect(createPath(window.location)).toEqual("/page5");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page5");
    expect(history.entryKey).toEqual("Inbox-3");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page2"},
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page3"},
        {entryKey: "Inbox-2", routerState: "/page4"},
    ]);

    history.push("/page6");
    router.state = "/page6";

    expect(createPath(window.location)).toEqual("/page6");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page6");
    expect(history.entryKey).toEqual("Inbox-4");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page2"},
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page3"},
        {entryKey: "Inbox-2", routerState: "/page4"},
        {entryKey: "Inbox-3", routerState: "/page5"},
    ]);

    history.go(-1);

    expect(createPath(window.location)).toEqual("/page5");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page5");
    expect(history.entryKey).toEqual("Inbox-3");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Home-2", routerState: "/page2"},
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page3"},
        {entryKey: "Inbox-2", routerState: "/page4"},
    ]);

    history.switchTab("Home");

    expect(createPath(window.location)).toEqual("/page2");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page2");
    expect(history.entryKey).toEqual("Home-2");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page3"},
        {entryKey: "Inbox-2", routerState: "/page4"},
        {entryKey: "Inbox-3", routerState: "/page5"},
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
    ]);

    history.go(-1);

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.entryKey).toEqual("Home-1");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page3"},
        {entryKey: "Inbox-2", routerState: "/page4"},
        {entryKey: "Inbox-3", routerState: "/page5"},
        {entryKey: "Home-0", routerState: "/home"},
    ]);

    history.switchTab("Create");

    expect(createPath(window.location)).toEqual("/create");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/create");
    expect(history.entryKey).toEqual("Create-0");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page3"},
        {entryKey: "Inbox-2", routerState: "/page4"},
        {entryKey: "Inbox-3", routerState: "/page5"},
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
    ]);

    expectNavigationRequestExternalPopCount(0);

    history.go(-1);

    expectNavigationRequestExternalPopCount(1);

    expect(createPath(window.location)).toEqual("/create");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/create");
    expect(history.entryKey).toEqual("Create-0");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page3"},
        {entryKey: "Inbox-2", routerState: "/page4"},
        {entryKey: "Inbox-3", routerState: "/page5"},
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
    ]);

    history.switchTab("Inbox");

    expect(createPath(window.location)).toEqual("/page5");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page5");
    expect(history.entryKey).toEqual("Inbox-3");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Create-0", routerState: "/create"},
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page3"},
        {entryKey: "Inbox-2", routerState: "/page4"},
    ]);

    history.go(-2);

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.entryKey).toEqual("Inbox-1");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Create-0", routerState: "/create"},
        {entryKey: "Inbox-0", routerState: "/inbox"},
    ]);

    history.push("/page7");
    router.state = "/page7";

    expect(createPath(window.location)).toEqual("/page7");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page7");
    expect(history.entryKey).toEqual("Inbox-2");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Create-0", routerState: "/create"},
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page3"},
    ]);

    history.push("/page8");
    router.state = "/page8";

    expect(createPath(window.location)).toEqual("/page8");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page8");
    expect(history.entryKey).toEqual("Inbox-3");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Create-0", routerState: "/create"},
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page3"},
        {entryKey: "Inbox-2", routerState: "/page7"},
    ]);

    history.push("/page9");
    router.state = "/page9";

    expect(createPath(window.location)).toEqual("/page9");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page9");
    expect(history.entryKey).toEqual("Inbox-4");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/home"},
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Create-0", routerState: "/create"},
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page3"},
        {entryKey: "Inbox-2", routerState: "/page7"},
        {entryKey: "Inbox-3", routerState: "/page8"},
    ]);

    history.push("/page10");
    router.state = "/page10";

    expect(createPath(window.location)).toEqual("/page10");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page10");
    expect(history.entryKey).toEqual("Inbox-5");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-1", routerState: "/page1"},
        {entryKey: "Create-0", routerState: "/create"},
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page3"},
        {entryKey: "Inbox-2", routerState: "/page7"},
        {entryKey: "Inbox-3", routerState: "/page8"},
        {entryKey: "Inbox-4", routerState: "/page9"},
    ]);

    history.switchTab("Home");

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.entryKey).toEqual("Home-1");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Create-0", routerState: "/create"},
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page3"},
        {entryKey: "Inbox-2", routerState: "/page7"},
        {entryKey: "Inbox-3", routerState: "/page8"},
        {entryKey: "Inbox-4", routerState: "/page9"},
        {entryKey: "Inbox-5", routerState: "/page10"},
    ]);

    history.go(-1);

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.entryKey).toEqual("Home-0");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Create-0", routerState: "/create"},
        {entryKey: "Inbox-0", routerState: "/inbox"},
        {entryKey: "Inbox-1", routerState: "/page3"},
        {entryKey: "Inbox-2", routerState: "/page7"},
        {entryKey: "Inbox-3", routerState: "/page8"},
        {entryKey: "Inbox-4", routerState: "/page9"},
        {entryKey: "Inbox-5", routerState: "/page10"},
    ]);
});

test("can pop with expected path", () => {
    const {history, router} = createHistory();

    expect(createPath(window.location)).toEqual("/home");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/home");
    expect(history.entryKey).toEqual("Home-0");
    expect(history.getInertRouterStates()).toEqual([]);

    history.goFromExternal(-1, new URL("/page1", window.location.href));

    expect(createPath(window.location)).toEqual("/page1");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page1");
    expect(history.entryKey).toEqual("Home-0");
    expect(history.getInertRouterStates()).toEqual([]);

    history.push("/page2");
    router.state = "/page2";

    expect(createPath(window.location)).toEqual("/page2");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page2");
    expect(history.entryKey).toEqual("Home-1");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-0", routerState: "/page1"}]);

    history.push("/page3");
    router.state = "/page3";

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.entryKey).toEqual("Home-2");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/page1"},
        {entryKey: "Home-1", routerState: "/page2"},
    ]);

    history.push("/page4");
    router.state = "/page4";

    expect(createPath(window.location)).toEqual("/page4");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page4");
    expect(history.entryKey).toEqual("Home-3");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/page1"},
        {entryKey: "Home-1", routerState: "/page2"},
        {entryKey: "Home-2", routerState: "/page3"},
    ]);

    history.goFromExternal(-1, new URL("/page3", window.location.href));

    expect(createPath(window.location)).toEqual("/page3");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page3");
    expect(history.entryKey).toEqual("Home-2");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/page1"},
        {entryKey: "Home-1", routerState: "/page2"},
    ]);

    history.goFromExternal(-1, new URL("/page5", window.location.href));

    expect(createPath(window.location)).toEqual("/page5");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page5");
    expect(history.entryKey).toEqual("Home-0");
    expect(history.getInertRouterStates()).toEqual([]);

    history.push("/page6");
    router.state = "/page6";

    expect(createPath(window.location)).toEqual("/page6");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page6");
    expect(history.entryKey).toEqual("Home-1");
    expect(history.getInertRouterStates()).toEqual([{entryKey: "Home-0", routerState: "/page5"}]);

    history.push("/page7");
    router.state = "/page7";

    expect(createPath(window.location)).toEqual("/page7");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page7");
    expect(history.entryKey).toEqual("Home-2");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/page5"},
        {entryKey: "Home-1", routerState: "/page6"},
    ]);

    history.switchTab("More");

    expect(createPath(window.location)).toEqual("/more");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/more");
    expect(history.entryKey).toEqual("More-0");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/page5"},
        {entryKey: "Home-1", routerState: "/page6"},
        {entryKey: "Home-2", routerState: "/page7"},
    ]);

    history.push("/page8");
    router.state = "/page8";

    expect(createPath(window.location)).toEqual("/page8");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page8");
    expect(history.entryKey).toEqual("More-1");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/page5"},
        {entryKey: "Home-1", routerState: "/page6"},
        {entryKey: "Home-2", routerState: "/page7"},
        {entryKey: "More-0", routerState: "/more"},
    ]);

    history.goFromExternal(-100, new URL("/page9", window.location.href));

    expect(createPath(window.location)).toEqual("/page9");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page9");
    expect(history.entryKey).toEqual("More-0");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/page5"},
        {entryKey: "Home-1", routerState: "/page6"},
        {entryKey: "Home-2", routerState: "/page7"},
    ]);

    history.push("/page10");
    router.state = "/page10";

    expect(createPath(window.location)).toEqual("/page10");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page10");
    expect(history.entryKey).toEqual("More-1");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/page5"},
        {entryKey: "Home-1", routerState: "/page6"},
        {entryKey: "Home-2", routerState: "/page7"},
        {entryKey: "More-0", routerState: "/page9"},
    ]);

    history.push("/page11");
    router.state = "/page11";

    expect(createPath(window.location)).toEqual("/page11");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page11");
    expect(history.entryKey).toEqual("More-2");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/page5"},
        {entryKey: "Home-1", routerState: "/page6"},
        {entryKey: "Home-2", routerState: "/page7"},
        {entryKey: "More-0", routerState: "/page9"},
        {entryKey: "More-1", routerState: "/page10"},
    ]);

    history.push("/page12");
    router.state = "/page12";

    expect(createPath(window.location)).toEqual("/page12");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page12");
    expect(history.entryKey).toEqual("More-3");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/page5"},
        {entryKey: "Home-1", routerState: "/page6"},
        {entryKey: "Home-2", routerState: "/page7"},
        {entryKey: "More-0", routerState: "/page9"},
        {entryKey: "More-1", routerState: "/page10"},
        {entryKey: "More-2", routerState: "/page11"},
    ]);

    history.push("/page13");
    router.state = "/page13";

    expect(createPath(window.location)).toEqual("/page13");
    expect(history.action).toEqual(Action.Push);
    expect(createPath(history.location)).toEqual("/page13");
    expect(history.entryKey).toEqual("More-4");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/page5"},
        {entryKey: "Home-1", routerState: "/page6"},
        {entryKey: "Home-2", routerState: "/page7"},
        {entryKey: "More-0", routerState: "/page9"},
        {entryKey: "More-1", routerState: "/page10"},
        {entryKey: "More-2", routerState: "/page11"},
        {entryKey: "More-3", routerState: "/page12"},
    ]);

    history.goFromExternal(-1, new URL("/page12", window.location.href));

    expect(createPath(window.location)).toEqual("/page12");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page12");
    expect(history.entryKey).toEqual("More-3");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/page5"},
        {entryKey: "Home-1", routerState: "/page6"},
        {entryKey: "Home-2", routerState: "/page7"},
        {entryKey: "More-0", routerState: "/page9"},
        {entryKey: "More-1", routerState: "/page10"},
        {entryKey: "More-2", routerState: "/page11"},
    ]);

    history.goFromExternal(-1, new URL("/page14", window.location.href));

    expect(createPath(window.location)).toEqual("/page14");
    expect(history.action).toEqual(Action.Pop);
    expect(createPath(history.location)).toEqual("/page14");
    expect(history.entryKey).toEqual("More-0");
    expect(history.getInertRouterStates()).toEqual([
        {entryKey: "Home-0", routerState: "/page5"},
        {entryKey: "Home-1", routerState: "/page6"},
        {entryKey: "Home-2", routerState: "/page7"},
    ]);
});
