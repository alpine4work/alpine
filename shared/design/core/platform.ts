import {assertEqualTypes} from "~/shared/helpers/control/assert_equal_types.open_source.js";

/**
 * The platforms listed here are environments our app runs in where each platform
 * has dramatically different user interface paradigms from the others. On desktop
 * the user has a wide screen and interacts with our app through a mouse and
 * keyboard (though some desktops also support touch interaction). On mobile the
 * user has a narrow screen and interacts with the app primarily through touch.
 *
 * We don't include operating systems like Windows, MacOS, Linux, Android, and iOS
 * in this platform list. Since the interaction paradigms are identical across
 * desktop operating systems (Windows, MacOS, and Linux) vs mobile operating
 * systems (Android and iOS).
 *
 * Candidates for new platforms could be `television` (user interacts with remote)
 * or `spatial` (user interacts through VR goggles or AR glasses in 3D space).
 * These platforms have dramatically different user interface paradigms we'd need
 * to go through and support.
 *
 * The platform defines how top-level navigation works in our app. For example, on
 * `desktop` we have a left navigation bar whereas on mobile we have a bottom
 * navigation bar.
 *
 * The platform may influence the `RouteLayout` and `SpacingScale`. On `mobile`
 * `RouteLayout` is always `narrow` and `SpacingScale` is always `large`.
 *
 * The platform is constant across the entire app. All components use the same
 * platform. Unlike `RouteLayout` where on `desktop` peeks use the `narrow` layout
 * and everything else uses the `wide` layout.
 */
export type Platform = "desktop" | "mobile";

/**
 * All the platforms.
 */
export const allPlatforms = ["desktop", "mobile"] as const;

assertEqualTypes<(typeof allPlatforms)[number], Platform>();

/**
 * The maximum window width for our mobile platform in pixels (inclusive).
 *
 * When the window width is less than or equal to this value we consider the app's
 * platform to be mobile. Note that window width is different from screen width. A
 * user could have a window smaller than 700px on a large monitor connected to
 * their MacOS desktop. In this case we consider the platform to be mobile even if
 * we're not on a touch device.
 *
 * So the app still needs to support mouse interactions even if the platform is
 * mobile and touch interactions even if the platform is desktop. The platform does
 * not define the available interaction modalities.
 *
 * When server rendering we don't know the window width. So we guess the platform
 * based on the screen width (from our `ClientInfo` cookie). So it's possible a
 * server render renders the app for desktop even though the screen size is a
 * mobile size. After the app hydrates it'll fix itself.
 */
export const mobilePlatformMaxWindowWidth = 768;
