import {Locator, Page} from "playwright";
import {random} from "remotion";

// SVG from https://github.com/daviddarnes/mac-cursors
const arrowCursorSvg = `<svg
  height="32"
  viewBox="0 0 32 32"
  width="32"
  xmlns="http://www.w3.org/2000/svg"
>
  <g fill="none" fill-rule="evenodd" transform="translate(10 7)">
    <path
      d="m6.148 18.473 1.863-1.003 1.615-.839-2.568-4.816h4.332l-11.379-11.408v16.015l3.316-3.221z"
      fill="#fff"
    />
    <path
      d="m6.431 17 1.765-.941-2.775-5.202h3.604l-8.025-8.043v11.188l2.53-2.442z"
      fill="#000"
    />
  </g>
</svg>`;

// SVG from https://github.com/daviddarnes/mac-cursors
const textCursorSvg = `<svg
  height="32"
  viewBox="0 0 32 32"
  width="32"
  xmlns="http://www.w3.org/2000/svg"
>
  <path
    d="m6.12306605-.48331676c.43304536-.02942018.89723494-.01586641 1.23506765.01110645l.09836607 2.00031187c-.52088553-.02633116-.86402421-.03615261-1.16297111-.01823278-.57216322.1246759-.83397559.26379885-1.13476879.47262866-.20678677.14251521-.54543639.60542479-.68837291.9244994v4.53970853h.998v1.984h-.998v3.57686113c.14285978.3186299.48159131.7805976.69278827.9256073.28177652.1964385.52739561.3374074.74486623.4121252.92617851.1117241.86141186.0439655 1.38886347.0608526l.24148845 1.9771822c-.63869922.0316331-1.03914186.0381475-1.41606129.0122618-.31198863-.0214264-.57343006-.0643378-.77405544-.129216-.41684626-.1296585-.85258908-.3604995-1.32295099-.6884424-.16852556-.1156905-.3571101-.2906327-.54285865-.4981462-.17040902.2017941-.33955796.3725205-.48392771.4855461-.40405946.3138676-.86631905.544191-1.35971316.6990619-.21164232.068207-.47249574.1108318-.78353769.1322303-.43450358.0298922-.90002831.0163041-1.23810501-.010835l-.09691742-2.0002571c.51770616.0263348.86168069.0362399 1.16109487.0181487.6186734-.1394818.87678125-.2519735 1.08726671-.4154673.19712987-.1543365.58456002-.6802379.70170954-.9838289l.01232275-3.57368433h-1.00027293v-1.984h1.002v-4.53315423c-.13203427-.30699537-.51655024-.83390163-.71128328-.98567507-.2013222-.15578504-.43877755-.27368925-.70166256-.36109174-.92774648-.11104657-.86334532-.04378063-1.3908609-.06035307l-.24301648-1.97729129c.64057546-.03160079 1.04058994-.03810767 1.41699023-.01249118.31067274.02114331.57118123.06339129.7795926.13006754.50016024.15848101.96025701.38783055 1.36565801.70154178.14340254.11176212.31252725.28238091.4832615.48453047.18451625-.20650555.37147758-.38041205.53791304-.49511426.47467546-.32956039.90822271-.55967002 1.31895768-.68980909.21133301-.06776711.4720386-.11004715.78312925-.13118199z"
    fill-rule="evenodd"
    stroke="#fff"
    stroke-linejoin="round"
    transform="translate(13 8)"
  />
</svg>
`;

// Hotspot offsets per cursor type. The cursor element's top-left is placed at the
// target (x, y), so types whose visual hotspot isn't the top-left corner need an
// offset to align the hotspot with the actual mouse position.
//
// Arrow: hotspot is at (0, 0) — the tip of the arrow is the top-left of the SVG.
// Text: the I-beam center is roughly at (16, 16) in the 32×32 SVG, so shift by
// (-16, -16) to center it on the click point.
const cursorConfigs = {
    default: {svg: arrowCursorSvg, offsetX: 0, offsetY: 0},
    text: {svg: textCursorSvg, offsetX: -16, offsetY: -16},
} as const;

export type CursorType = keyof typeof cursorConfigs;

// CSS `cursor` computed values that map to each fake cursor type.
const cssCursorTypeMap: Record<string, CursorType> = {
    text: "text",
    "vertical-text": "text",
};

/**
 * A fake mouse cursor injected into the browser page for demo recordings.
 *
 * Playwright moves the real mouse instantaneously between positions, so the OS
 * cursor jumps around rather than flowing smoothly. This class:
 *
 * - Renders a fake cursor SVG element that animates smoothly to each target
 * - Moves the real Playwright mouse to the destination after each animation so CSS
 *   `:hover` states, focus rings, and click events still work correctly
 * - Automatically switches between arrow and text I-beam cursors based on the
 *   computed cursor style of the element under the mouse
 *
 * Usage:
 *
 * ```ts
 * const cursor = await createDemoCursor(page);
 * await cursor.jumpTo(200, 300); // instant — no animation
 * await cursor.moveToElement(locator); // smooth move, cursor type auto-detected
 * await cursor.clickElement(locator); // smooth move + click
 * await cursor.hide(); // hide during non-interactive pauses
 * await cursor.show();
 * await cursor.setCursorType("text"); // manual override
 * ```
 */
export class DemoCursor {
    private _x = 0;
    private _y = 0;
    private _cursorType: CursorType = "default";
    private _randomSeed: number;

    constructor(
        private readonly _page: Page,
        randomSeed?: number,
    ) {
        this._randomSeed = randomSeed ?? Date.now();
    }

    /**
     * Inject the fake cursor element and hide the real OS cursor. Call once after the
     * page has loaded (or after a navigation that resets the DOM).
     */
    async setup(): Promise<void> {
        await this._page.evaluate(
            ({configs}) => {
                // Idempotent — safe to call after a soft navigation.
                if (document.getElementById("__demo_cursor__")) return;

                const el = document.createElement("div");
                el.id = "__demo_cursor__";
                el.style.cssText = [
                    "position: fixed",
                    "top: 0",
                    "left: 0",
                    "width: 32px",
                    "height: 32px",
                    "pointer-events: none",
                    "z-index: 2147483647",
                    "transform: translate(0px, 0px)",
                    "will-change: transform",
                ].join("; ");
                el.innerHTML = configs.default.svg;
                // Stash all cursor configs on the element so type-switching can happen entirely
                // inside page.evaluate without extra round-trips.
                el.dataset.configs = JSON.stringify(configs);
                el.dataset.cursorType = "default";
                document.body.appendChild(el);
            },
            {configs: cursorConfigs},
        );
    }

    /** Hide the cursor (e.g. during non-interactive pauses). */
    async hide(): Promise<void> {
        await this._page.evaluate(() => {
            const el = document.getElementById("__demo_cursor__");
            if (el) el.style.visibility = "hidden";
        });
    }

    /** Show the cursor after a previous `hide()`. */
    async show(): Promise<void> {
        await this._page.evaluate(() => {
            const el = document.getElementById("__demo_cursor__");
            if (el) el.style.visibility = "visible";
        });
    }

    /**
     * Manually switch between cursor types. By default the type is auto-detected after
     * each `moveTo` / `jumpTo`, so only use this when you need to override that
     * behaviour (e.g. before typing into a text field after clicking it).
     */
    async setCursorType(type: CursorType): Promise<void> {
        await this._page.evaluate(
            ({type, x, y}) => {
                const el = document.getElementById("__demo_cursor__");
                if (!el) return;
                const configs = JSON.parse(el.dataset.configs ?? "{}");
                const config = configs[type];
                if (!config) return;
                el.innerHTML = config.svg;
                el.style.transform = `translate(${x + config.offsetX}px, ${y + config.offsetY}px)`;
                el.dataset.cursorType = type;
            },
            {type, x: this._x, y: this._y},
        );
        this._cursorType = type;
    }

    /**
     * Teleport the cursor to `(x, y)` with no animation. Use this to establish the
     * starting position before the first animated move. Auto-detects cursor type.
     */
    async jumpTo(x: number, y: number): Promise<void> {
        const {offsetX, offsetY} = cursorConfigs[this._cursorType];
        await this._page.evaluate(
            ({x, y}) => {
                const el = document.getElementById("__demo_cursor__");
                if (el) el.style.transform = `translate(${x}px, ${y}px)`;
            },
            {x: x + offsetX, y: y + offsetY},
        );
        this._x = x;
        this._y = y;
        await this._page.mouse.move(x, y);
        await this._autoUpdateCursorType();
    }

    /**
     * Smoothly animate the cursor from its current position to `(x, y)`.
     *
     * After the animation the real Playwright mouse is also moved to `(x, y)` so CSS
     * `:hover` states update correctly before any subsequent click. Cursor type is
     * auto-detected at the destination.
     */
    async moveTo(x: number, y: number, durationMs = 450): Promise<void> {
        const fromX = this._x;
        const fromY = this._y;
        // Use the current type's offset for the entire animation path — the type will be
        // re-detected and snapped at the destination after the animation completes.
        const {offsetX, offsetY} = cursorConfigs[this._cursorType];

        // Compute a slight arc so the path curves like a real hand gesture rather than
        // travelling in a perfectly straight line. The arc is a perpendicular offset that
        // peaks at the midpoint of the move and falls back to zero at the destination.
        //
        // The amplitude is 1–3% of the travel distance (1% plus up to 2% more from
        // `random`, per move). The direction alternates randomly left/right of the
        // movement vector.
        const dx = x - fromX;
        const dy = y - fromY;
        const distance = Math.sqrt(dx * dx + dy * dy);

        const arcSign = random(this._randomSeed) < 0.5 ? 1 : -1;
        const arcAmplitude = distance * (0.01 + random(this._randomSeed + 1) * 0.02);
        this._randomSeed += 2; // Increment for next moveTo() call

        // Perpendicular unit vector (direction rotated 90°).
        const arcX = distance > 0 ? (-dy / distance) * arcAmplitude * arcSign : 0;
        const arcY = distance > 0 ? (dx / distance) * arcAmplitude * arcSign : 0;

        await this._page.evaluate(
            ({fromX, fromY, toX, toY, duration, offsetX, offsetY, arcX, arcY}) => {
                return new Promise<void>(resolve => {
                    const el = document.getElementById("__demo_cursor__");
                    if (!el) {
                        resolve();
                        return;
                    }

                    const startTime = performance.now();

                    function step(now: number) {
                        const t = Math.min((now - startTime) / duration, 1);
                        // Ease-in-out quad
                        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                        // Arc offset peaks at the midpoint via a sine curve and is zero at both endpoints,
                        // so the cursor always lands exactly on the target.
                        const arc = Math.sin(Math.PI * t);
                        const cx = fromX + (toX - fromX) * eased + arcX * arc;
                        const cy = fromY + (toY - fromY) * eased + arcY * arc;
                        el!.style.transform = `translate(${cx + offsetX}px, ${cy + offsetY}px)`;
                        if (t < 1) {
                            requestAnimationFrame(step);
                        } else {
                            resolve();
                        }
                    }

                    requestAnimationFrame(step);
                });
            },
            {fromX, fromY, toX: x, toY: y, duration: durationMs, offsetX, offsetY, arcX, arcY},
        );

        this._x = x;
        this._y = y;
        // Sync real mouse so :hover states fire at the destination.
        await this._page.mouse.move(x, y);
        // Detect and apply the correct cursor type for the element now under the mouse.
        await this._autoUpdateCursorType();
    }

    /**
     * Smoothly animate the cursor to the center of `locator`'s bounding box.
     */
    async moveToElement(
        locator: Locator,
        durationMs?: number,
        {xOffset = 0, yOffset = 0}: {xOffset?: number; yOffset?: number} = {},
    ): Promise<void> {
        const box = await locator.boundingBox();
        if (!box) return;
        await this.moveTo(
            box.x + box.width / 2 + xOffset,
            box.y + box.height / 2 + yOffset,
            durationMs,
        );
    }

    /**
     * Smoothly animate to `(x, y)` then fire a real mouse click at that position.
     */
    async click(x: number, y: number, durationMs?: number): Promise<void> {
        await this.moveTo(x, y, durationMs);
        await this._page.mouse.click(x, y);
    }

    /**
     * Smoothly animate to the center of `locator` then fire a real mouse click. Pass
     * `xOffset`/`yOffset` to shift the click point relative to the element center.
     */
    async clickElement(
        locator: Locator,
        durationMs?: number,
        {xOffset = 0, yOffset = 0}: {xOffset?: number; yOffset?: number} = {},
    ): Promise<void> {
        const box = await locator.boundingBox();
        if (!box) return;
        await this.click(
            box.x + box.width / 2 + xOffset,
            box.y + box.height / 2 + yOffset,
            durationMs,
        );
    }

    /**
     * Inspect the element under the current mouse position and switch to the matching
     * cursor type if it has changed. Called automatically after every `moveTo` and
     * `jumpTo`.
     */
    private async _autoUpdateCursorType(): Promise<void> {
        const newType = await this._page.evaluate(
            ({x, y, cssMap}) => {
                const el = document.getElementById("__demo_cursor__");
                if (!el) return null;

                // Temporarily hide the cursor element so it doesn't occlude the target.
                // (pointer-events:none excludes it from events but not elementFromPoint.)
                el.style.visibility = "hidden";
                const target = document.elementFromPoint(x, y);
                el.style.visibility = "visible";

                if (!target) return null;

                const computedCursor = getComputedStyle(target).cursor;
                const type: string = cssMap[computedCursor] ?? "default";

                // Only update if the type actually changed to avoid unnecessary DOM writes.
                if (el.dataset.cursorType === type) return type;

                const configs = JSON.parse(el.dataset.configs ?? "{}");
                const config = configs[type];
                if (!config) return null;

                el.innerHTML = config.svg;
                el.style.transform = `translate(${x + config.offsetX}px, ${y + config.offsetY}px)`;
                el.dataset.cursorType = type;
                return type;
            },
            {x: this._x, y: this._y, cssMap: cssCursorTypeMap},
        );

        if (newType === "default" || newType === "text") {
            this._cursorType = newType;
        }
    }
}

/**
 * Create and inject a fake mouse cursor into the page for demo recordings. Applies
 * a Quadratic Ease-in-out curve to the cursor movement with a small amount of
 * randomness. Optionally pass in a `randomSeed` to make the cursor movements more
 * deterministic.
 *
 * @example
 *
 * ```ts
 * actions: [
 *     async page => {
 *         const cursor = await createDemoCursor(page);
 *         await cursor.jumpTo(400, 300);
 *
 *         await cursor.moveToElement(taskRow);
 *         await taskRow.hover(); // still needed for CSS :hover
 *
 *         await cursor.clickElement(
 *             taskRow.getByRole("button", {name: "Open"}).first(),
 *         );
 *     },
 * ];
 * ```
 */
export async function createDemoCursor(page: Page, randomSeed?: number): Promise<DemoCursor> {
    const cursor = new DemoCursor(page, randomSeed);
    await cursor.setup();
    return cursor;
}
