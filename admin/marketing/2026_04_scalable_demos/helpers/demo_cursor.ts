import {Locator, Page} from "playwright";
import {random} from "remotion";
import {Rectangle} from "~/shared/helpers/geometry/rectangle.js";
import {Vector2} from "~/shared/helpers/geometry/vector2.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
import {html} from "~/shared/helpers/string/html.js";

// SVG from https://github.com/daviddarnes/mac-cursors
const arrowCursorSvg = html`
    <svg height="32" viewBox="0 0 32 32" width="32" xmlns="http://www.w3.org/2000/svg">
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
    </svg>
`;

// SVG from https://github.com/daviddarnes/mac-cursors
const textCursorSvg = html`
    <svg height="32" viewBox="0 0 32 32" width="32" xmlns="http://www.w3.org/2000/svg">
        <path
            d="m6.12306605-.48331676c.43304536-.02942018.89723494-.01586641 1.23506765.01110645l.09836607 2.00031187c-.52088553-.02633116-.86402421-.03615261-1.16297111-.01823278-.57216322.1246759-.83397559.26379885-1.13476879.47262866-.20678677.14251521-.54543639.60542479-.68837291.9244994v4.53970853h.998v1.984h-.998v3.57686113c.14285978.3186299.48159131.7805976.69278827.9256073.28177652.1964385.52739561.3374074.74486623.4121252.92617851.1117241.86141186.0439655 1.38886347.0608526l.24148845 1.9771822c-.63869922.0316331-1.03914186.0381475-1.41606129.0122618-.31198863-.0214264-.57343006-.0643378-.77405544-.129216-.41684626-.1296585-.85258908-.3604995-1.32295099-.6884424-.16852556-.1156905-.3571101-.2906327-.54285865-.4981462-.17040902.2017941-.33955796.3725205-.48392771.4855461-.40405946.3138676-.86631905.544191-1.35971316.6990619-.21164232.068207-.47249574.1108318-.78353769.1322303-.43450358.0298922-.90002831.0163041-1.23810501-.010835l-.09691742-2.0002571c.51770616.0263348.86168069.0362399 1.16109487.0181487.6186734-.1394818.87678125-.2519735 1.08726671-.4154673.19712987-.1543365.58456002-.6802379.70170954-.9838289l.01232275-3.57368433h-1.00027293v-1.984h1.002v-4.53315423c-.13203427-.30699537-.51655024-.83390163-.71128328-.98567507-.2013222-.15578504-.43877755-.27368925-.70166256-.36109174-.92774648-.11104657-.86334532-.04378063-1.3908609-.06035307l-.24301648-1.97729129c.64057546-.03160079 1.04058994-.03810767 1.41699023-.01249118.31067274.02114331.57118123.06339129.7795926.13006754.50016024.15848101.96025701.38783055 1.36565801.70154178.14340254.11176212.31252725.28238091.4832615.48453047.18451625-.20650555.37147758-.38041205.53791304-.49511426.47467546-.32956039.90822271-.55967002 1.31895768-.68980909.21133301-.06776711.4720386-.11004715.78312925-.13118199z"
            fill-rule="evenodd"
            stroke="#fff"
            stroke-linejoin="round"
            transform="translate(13 8)"
        />
    </svg>
`;

// SVG from https://github.com/daviddarnes/mac-cursors
const handpointingCursorSvg = html`
    <svg height="32" viewBox="0 0 32 32" width="32" xmlns="http://www.w3.org/2000/svg">
        <g fill="none" fill-rule="evenodd" transform="translate(9 8)">
            <path
                d="m3.8852309 13.5522788c.15029277.1354048.25406355.2326609.57471053.5372549.31406586.2983172.46594413.439273.60482646.5572091.05791893.0487853.10729946.1792495.12686364.3731628.01609788.1595565.01049553.3375341-.0090192.5090254-.00674888.0593077-.01325791.1020883-.01698742.1224696-.04186639.2287942.13249226.4401222.36507344.4424801.20929712.0021219.37056581.00472.79741331.0123273.10679864.0019014.10679864.0019014.21395196.0037648 1.16029156.0199598 1.75290683.01448 2.1782236-.039003.45462139-.05716.92282087-.6061887 1.32754658-1.2951218.3429437.6096032.818651 1.2048784 1.2990136 1.282277.1525992.0243739.3372104.0319365.5511764.0270146.1595258-.0036697.328349-.0141847.4987188-.0294071.1284742-.0114791.2308379-.0230173.2919821-.0309462.2259121-.0292954.3737346-.2515956.31337-.4712558-.0130388-.0474468-.0339905-.1345046-.0551176-.2441066-.0244927-.1270617-.0421932-.2511642-.0502379-.3642189-.0051002-.0716765-.0061057-.1365707-.0028638-.1926702.0056365-.097781.007395-.1525378.0101327-.2790463.0010457-.0470941.0010457-.0470941.0024433-.0883088.0052898-.134881.0234093-.2629524.0820463-.5422232.0251901-.1212103.1472903-.3531692.3395862-.6402332.0572734-.0854992.1198813-.1747825.1869659-.2669588.127207-.1747861.2641214-.3514011.4010853-.5204043.0820457-.1012383.1454717-.1769623.1807968-.2180763.2962199-.424403.6120842-1.1191696.7281396-1.5253635.111416-.3904017.2005405-1.10937558.2553074-1.81604479.0300143-.40088807.0411211-.72405394.0411211-1.23097561.0000507-.08891816.0000507-.08891816.0002032-.16234685.0002858-.12025251.0003032-.16573976-.0000887-.22195195-.0010706-.15358041-.0055478-.30580145-.0203882-.6940256-.0319191-.81365149-.4778003-1.3396911-1.1348711-1.44115781-.5589865-.08632026-1.2393839.37795756-1.2393839.37795756s-.1514404-.5228127-.2537197-.6842075c-.1661957-.25934741-.5941748-.58982828-.9213451-.65421118-.3365014-.0653413-.7354024-.05811592-1.1017193.00667481-.3207944.05740454-.64034865.34382687-.82518751.65277182-.13223727.22039488-.00786932-.01169164-.14013104-.2396787-.1830552-.31402315-.60932935-.59522407-1.01524567-.67822294-.34396352-.07112559-.73801897-.04403625-1.09795562.06293793-.46304125.13836397-.53675291.49073282-.55516748.38984626-.06158674-.3382385-.06727482-.3160095-.105656-.55729603-.14258072-.89527436-.30213161-1.51473549-.54406219-2.05528331.01391678.0310773-.08860981-.20214701-.12592279-.28256779-.06461002-.13925416-.12910532-.2652956-.19999629-.38652204-.21850342-.37364978-.46891278-.65340904-.7830908-.81233894-.54561037-.27629378-1.3634177-.14183064-1.75105565.31064856-.38495968.44966797-.4491432 1.20149287-.3521966 2.13184003.03702376.36121263.16678627 1.02066144.28444961 1.50812387.04160602.1691894.07805979.32348903.14491578.60851331.01149723.04848415.01149723.04848415.02309483.09698036.05172236.21571896.09707607.39320067.15122332.5879629-.00568154-.02030261.09701461.344086.11888835.42472961.00727686.02691587.00727686.02691587.01448296.05395339.04082856.15377935.08074083.31959314.14309954.5963099.03412572.1521447.06742545.31468601.09999775.48699018.08883553.46993091.089274.37207374.00375852.27186198-.05907319-.06922522-.11463055-.13209255-.16830659-.19003644-.09976937-.10770214-.19148509-.19677225-.2785569-.2678141-.6343975-.51905295-1.02312991-.74839425-1.55681885-.79878106-.87541567-.08410158-1.70619803.53426712-1.83111632 1.36882761-.07682697.51169638-.05207639.74723271.18463583 1.19942735.13026223.24432805.35060714.53942202.76172732 1.04735429.02515953.031068.02515953.031068.05030428.06206416.50464537.62186746.55962098.69095396.67961467.86473786.32435479.4706845 1.1139501 1.8221455 1.25748612 2.0035872z"
                fill="#000"
            />
            <path
                d="m1.68266944 9.2716401c-.02488625-.03067752-.02488625-.03067752-.04970567-.06132555-.37729166-.46613768-.58418002-.74321015-.68156241-.9258495-.15281729-.29195235-.1611316-.37107459-.10605794-.73788601.06473349-.43247455.53181583-.78013371 1.01829549-.73339767.33660502.03178017.63068475.20527903 1.15339692.63295262.0565942.04617564.12482853.1124417.20288232.19670163.04616569.04983637.09513192.10524534.14800114.16720042.0794093.0930562.34702847.42052231.30761424.37286894.05814283.06991619.09971852.12407704.14721655.19045018.0941062.13434104.14705111.20894642.21874992.30454484-.0336171-.04487143.21473082.29843305.26732159.34863333.27859812.26593456.68203289.04195871.65675979-.31244785-.00421914-.05916537-.01812774-.12308431-.04717934-.23466885-.11487425-.81923739-.15505751-1.08218312-.24678252-1.56739907-.03407352-.18024544-.06905328-.35098727-.10521102-.5121905-.06435409-.28557213-.10635725-.46007245-.14994794-.62425526-.00774801-.02907063-.00774801-.02907063-.01552357-.05783095-.02300644-.08481964-.12725123-.45470311-.12030828-.42989063-.05134381-.18468043-.0945453-.35373996-.14431997-.56133562-.01130896-.04728909-.01130896-.04728909-.02259904-.09489949-.06649254-.28350912-.10387999-.44176072-.14606063-.6132721-.10998732-.45567652-.23425389-1.08719519-.2671036-1.40768017-.07546665-.72422018-.02339381-1.33418457.17582284-1.56688778.15554834-.1815673.59641015-.25405339.84271752-.12932486.16107512.0814814.32204278.26131571.47435101.521769.05764302.09857191.11172763.20426801.16708381.32357735.0335256.07225783.13292567.29837003.12172905.27336705.21032209.46992469.354801 1.03086841.48791736 1.86671535.03939531.24766201.08813662.52823537.15063928.87150416.01857903.10178746.01857903.10178746.03722922.20314381.30139226 1.63533599.27933797 1.51139381.28367122 1.64182468.01580667.47578071.71810567.4869267.74900255.01188722.00979855-.15065269.00630989-.2851661-.01107827-.67146517-.00245496-.05465243-.00245496-.05465243-.00481877-.10910149-.01521525-.35590459-.01433687-.56066672.00670546-.67705709.03834708-.21223125.22887-.4499778.40434754-.50241339.24641865-.07323589.51640341-.09179599.73269877-.04707051.20703808.0423346.44864736.20171736.51796318.32062499.08353628.14399789.15516008.36337367.21006107.63530456.04431149.21947986.07480439.45493493.0962536.70624261.00667352.0781897.01103024.13859819.01772256.23854675.00285005.04183594.00285005.04183594.00568968.07635213.00160285.01731471.00160285.01731471.00551199.04467336.00303535.01917374.00303535.01917374.01734216.06773608.00727602.13782339.00727602.13782339.56081544.18893151.16530264-.19982737.16530264-.19982737.16077268-.23486454.02708074-.1183491.04365279-.250265.06727822-.49813693.01508098-.16112409.02268576-.24033521.03157416-.32249887.036794-.34012028.0835164-.55621578.140511-.65120691.0707148-.11819408.3197845-.28280909.4314962-.30279961.2805348-.04961763.5886064-.0551978.8264635-.00901194.1077347.021202.3705429.22413969.4327499.32121002.1277282.20156171.2519621.8513817.3219188 1.49611734-.0110122.04228902-.0110122.04228902.1607163.28760404.5903408-.06730286.5903408-.06730286.5737568-.17389206.0155734-.03799147.0279666-.08191522.0455068-.15013809.0421947-.1597068.0701719-.25243998.1118273-.35635899.0288165-.07188915.0591935-.13335501.0903398-.18227881.120675-.18992919.4330876-.31896311.7070596-.2766556.2942545.0454396.4817569.26665023.4998934.72896761.0145423.38042999.0188438.52667972.0198445.67022961.0003693.0529684.0003531.09548963.0000723.21509672-.0001536.07391241-.0001536.07391241-.000205.16397385 0 .48892448-.010469.79353263-.0389535 1.17400348-.0506294.653266-.1361064 1.34281542-.228649 1.66708482-.094456.330596-.3764591.9508823-.5997469 1.2734975-.0158389.0153017-.0838055.0964468-.1706932.2036597-.1445918.1784155-.2892331.364998-.4248114.5512865-.0725632.099704-.140705.1968792-.2036767.2908847-.2436695.3637558-.4000227.6607868-.4506249.9042828-.0664376.3164194-.0901813.4842425-.0973169.666189-.0017426.0515155-.0017426.0515155-.0028439.1014735-.0025547.1180556-.0040857.165727-.0090621.2520573-.0052398.0906702-.0037444.1871795.0035093.2891187.0103883.145992.0000001.3454812.0000001.3454812s-.1266332-.0118299-.2678551-.0085813c-.1725177.0039685-.3159859-.0019087-.4151297-.0177442-.143046-.0230487-.5293508-.5064503-.7271506-.8830611-.3022704-.5764228-1.03604858-.5484427-1.33684295-.0394061-.27130191.4618137-.65965243.9172085-.77493336.9317029-.37460536.047106-.95471158.0524702-2.07175566.0332544-.10679478-.0018572-.10679478-.0018572-.21348729-.0037567-.42889761-.0076439-.41241496.0647655-.40363307-.0124079.02506967-.2203068.02222332-.1790312.00000011-.3992999-.03726222-.36933-.15125405-.6704984-.38877094-.8705429-.12286946-.1043424-.26983033-.2407345-.56500741-.5211097-.33722428-.3203411-.44283686-.4193233-.57299128-.5337266l-.80130455-.8907189c-.08795856-.1124788-.86002339-1.4339349-1.21248613-1.9454077-.13710846-.19857111-.18839645-.26302343-.71461353-.9114734zm9.50873056.0037599v3.459c0 .5.75.5.75 0v-3.459c0-.5-.75-.5-.75 0zm-2.03159602-.00057241.016 3.47300001c.00230346.4999947.7522955.4965395.74999204-.0034552l-.016-3.47299999c-.00230346-.4999947-.7522955-.49653951-.74999204.00345518zm-1.20911102 3.45357381-.021-3.42599996c-.00306475-.4999906-.75305066-.49539349-.74998592.00459712l.021 3.42600004c.00306475.4999906.75305066.4953935.74998592-.0045972z"
                fill="#fff"
            />
        </g>
    </svg>
`;

// Hotspot offsets per cursor type. Each offset shifts the cursor element's
// top-left corner so the visual hotspot aligns with the target mouse position. The
// CSS transform origin is the inverse of this offset, which keeps scaling anchored
// on that hotspot.
const cursorConfigs = {
    default: {svg: arrowCursorSvg, offsetX: -9, offsetY: -8},
    pointer: {svg: handpointingCursorSvg, offsetX: -9, offsetY: -8},
    text: {svg: textCursorSvg, offsetX: -16, offsetY: -16},
} as const;

export type CursorType = keyof typeof cursorConfigs;

function cursorTransformOrigin({
    offsetX,
    offsetY,
}: {
    readonly offsetX: number;
    readonly offsetY: number;
}): string {
    return `${-offsetX}px ${-offsetY}px`;
}

// CSS `cursor` computed values that map to each fake cursor type.
const cssCursorTypeMap: Record<string, CursorType> = {
    pointer: "pointer",
    text: "text",
    "vertical-text": "text",
};

const cursorDropShadow = "drop-shadow(-0.375px 0.875px 0.9375px rgb(0 0 0 / 30%))";

const cursorClickPressDurationMs = 300;
const cursorElementClickInsetPx = 8;

export type DemoCursorOptions = {
    readonly dispatchPointerMoveEvents?: boolean;
    readonly randomSeed?: number;
    readonly scale?: number;
    readonly watchCssCursor?: boolean;
};

type DemoCursorMoveOptions = {
    readonly dispatchPointerMoveEvents?: boolean;
    readonly watchCssCursor?: boolean;
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
 * - Can dispatch synthetic `pointermove` events during the animation for
 *   components that respond to the pointer's intermediate positions
 * - Automatically switches between arrow, hand pointer, and text I-beam cursors
 *   based on the computed cursor style of the element under the mouse
 *
 * Usage:
 *
 * ```ts
 * const cursor = await createDemoCursor(page, {scale: 3, watchCssCursor: true});
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
    private readonly _dispatchPointerMoveEvents: boolean;
    private readonly _scale: number;
    private readonly _watchCssCursor: boolean;

    constructor(
        private readonly _page: Page,
        optionsOrRandomSeed?: number | DemoCursorOptions,
    ) {
        const options =
            typeof optionsOrRandomSeed === "number"
                ? {randomSeed: optionsOrRandomSeed}
                : (optionsOrRandomSeed ?? {});
        this._randomSeed = options.randomSeed ?? Date.now();
        this._dispatchPointerMoveEvents = options.dispatchPointerMoveEvents ?? false;
        this._scale = options.scale ?? 1;
        this._watchCssCursor = options.watchCssCursor ?? false;
    }

    /**
     * Inject the fake cursor element and hide the real OS cursor. Call once after the
     * page has loaded (or after a navigation that resets the DOM).
     */
    async setup(): Promise<void> {
        await this._page.evaluate(
            ({configs, cursorDropShadow, cursorType, scale, x, y}) => {
                function getTransformOrigin(config: {offsetX: number; offsetY: number}): string {
                    return `${-config.offsetX}px ${-config.offsetY}px`;
                }

                const config = configs[cursorType] ?? configs.default;
                const transform = `translate(${x + config.offsetX}px, ${
                    y + config.offsetY
                }px) scale(${scale})`;

                // Idempotent — safe to call after a soft navigation.
                const existingEl = document.getElementById("__demo_cursor__");
                if (existingEl) {
                    existingEl.dataset.configs = JSON.stringify(configs);
                    existingEl.dataset.cursorType = cursorType;
                    existingEl.dataset.scale = String(scale);
                    existingEl.style.filter = cursorDropShadow;
                    existingEl.style.transform = transform;
                    existingEl.style.transformOrigin = getTransformOrigin(config);
                    return;
                }

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
                    `filter: ${cursorDropShadow}`,
                    `transform: ${transform}`,
                    `transform-origin: ${getTransformOrigin(config)}`,
                    "will-change: transform",
                ].join("; ");
                el.innerHTML = config.svg;
                // Stash all cursor configs on the element so type-switching can happen entirely
                // inside page.evaluate without extra round-trips.
                el.dataset.configs = JSON.stringify(configs);
                el.dataset.cursorType = cursorType;
                el.dataset.scale = String(scale);
                document.body.appendChild(el);
            },
            {
                configs: cursorConfigs,
                cursorDropShadow,
                cursorType: this._cursorType,
                scale: this._scale,
                x: this._x,
                y: this._y,
            },
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
            ({type, x, y, scale}) => {
                const el = document.getElementById("__demo_cursor__");
                if (!el) return;
                const configs = JSON.parse(el.dataset.configs ?? "{}");
                const config = configs[type];
                if (!config) return;
                el.innerHTML = config.svg;
                el.style.transform = `translate(${x + config.offsetX}px, ${
                    y + config.offsetY
                }px) scale(${scale})`;
                el.style.transformOrigin = `${-config.offsetX}px ${-config.offsetY}px`;
                el.dataset.cursorType = type;
            },
            {type, x: this._x, y: this._y, scale: this._scale},
        );
        this._cursorType = type;
    }

    /**
     * Teleport the cursor to `(x, y)` with no animation. Use this to establish the
     * starting position before the first animated move. Auto-detects cursor type.
     */
    async jumpTo(x: number, y: number): Promise<void> {
        const {offsetX, offsetY} = cursorConfigs[this._cursorType];
        const transformOrigin = cursorTransformOrigin(cursorConfigs[this._cursorType]);
        await this._page.evaluate(
            ({x, y, scale, transformOrigin}) => {
                const el = document.getElementById("__demo_cursor__");
                if (el) {
                    el.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
                    el.style.transformOrigin = transformOrigin;
                }
            },
            {
                x: x + offsetX,
                y: y + offsetY,
                scale: this._scale,
                transformOrigin,
            },
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
     * auto-detected at the destination. Pass `dispatchPointerMoveEvents` to notify
     * page-level pointer listeners throughout the animation.
     */
    async moveTo(
        x: number,
        y: number,
        durationMs = 450,
        {
            dispatchPointerMoveEvents = this._dispatchPointerMoveEvents,
            watchCssCursor = this._watchCssCursor,
        }: DemoCursorMoveOptions = {},
    ): Promise<void> {
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

        const newType = await this._page.evaluate(
            ({
                fromX,
                fromY,
                toX,
                toY,
                duration,
                offsetX,
                offsetY,
                arcX,
                arcY,
                dispatchPointerMoveEvents,
                scale,
                watchCssCursor,
                cssMap,
            }) => {
                return new Promise<string | null>(resolve => {
                    const el = document.getElementById("__demo_cursor__");
                    if (!el) {
                        resolve(null);
                        return;
                    }

                    const configs = JSON.parse(el.dataset.configs ?? "{}");
                    const startTime = performance.now();

                    function elementForNode(node: Node | null): Element | null {
                        if (!node) return null;
                        if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
                        return node.parentElement;
                    }

                    function caretElementFromPoint(x: number, y: number): Element | null {
                        const doc = document as Document & {
                            caretPositionFromPoint?: (
                                x: number,
                                y: number,
                            ) => {offsetNode: Node} | null;
                            caretRangeFromPoint?: (x: number, y: number) => Range | null;
                        };
                        const caretPosition = doc.caretPositionFromPoint?.(x, y);
                        if (caretPosition) return elementForNode(caretPosition.offsetNode);
                        const caretRange = doc.caretRangeFromPoint?.(x, y);
                        return elementForNode(caretRange?.startContainer ?? null);
                    }

                    function cursorCssFromPoint(x: number, y: number): string {
                        const {caretElement, target} = withHiddenCursor(() => ({
                            caretElement: caretElementFromPoint(x, y),
                            target: document.elementFromPoint(x, y),
                        }));

                        if (target) {
                            const targetCursor = getComputedStyle(target).cursor;
                            if (targetCursor !== "auto") return targetCursor;
                        }

                        if (caretElement) {
                            const caretCursor = getComputedStyle(caretElement).cursor;
                            return caretCursor === "auto" ? "text" : caretCursor;
                        }

                        return "default";
                    }

                    function cursorTypeFromCss(cssCursor: string): string {
                        const parts = cssCursor.split(",");
                        const fallbackCursor = parts[parts.length - 1]?.trim() ?? cssCursor;
                        return cssMap[cssCursor] ?? cssMap[fallbackCursor] ?? "default";
                    }

                    function getTransformOrigin(config: {
                        offsetX: number;
                        offsetY: number;
                    }): string {
                        return `${-config.offsetX}px ${-config.offsetY}px`;
                    }

                    function withHiddenCursor<T>(callback: () => T): T {
                        const previousVisibility = el!.style.visibility;
                        el!.style.visibility = "hidden";
                        try {
                            return callback();
                        } finally {
                            el!.style.visibility = previousVisibility;
                        }
                    }

                    function applyCursorTypeIfNeeded(type: string) {
                        if (el!.dataset.cursorType === type) return;
                        const config = configs[type];
                        if (!config) return;
                        el!.innerHTML = config.svg;
                        el!.style.transformOrigin = getTransformOrigin(config);
                        el!.dataset.cursorType = type;
                    }

                    function dispatchPointerMoveEvent(x: number, y: number) {
                        withHiddenCursor(() => {
                            const target = document.elementFromPoint(x, y) ?? document;
                            const eventInit = {
                                bubbles: true,
                                cancelable: true,
                                clientX: x,
                                clientY: y,
                                composed: true,
                            };
                            const event =
                                typeof PointerEvent === "function"
                                    ? new PointerEvent("pointermove", {
                                          ...eventInit,
                                          isPrimary: true,
                                          pointerId: 1,
                                          pointerType: "mouse",
                                      })
                                    : new MouseEvent("pointermove", {
                                          ...eventInit,
                                      });
                            target.dispatchEvent(event);
                        });
                    }

                    function step(now: number) {
                        const t = Math.min((now - startTime) / duration, 1);
                        // Ease-in-out quad
                        const eased = t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2;
                        // Arc offset peaks at the midpoint via a sine curve and is zero at both endpoints,
                        // so the cursor always lands exactly on the target.
                        const arc = Math.sin(Math.PI * t);
                        const cx = fromX + (toX - fromX) * eased + arcX * arc;
                        const cy = fromY + (toY - fromY) * eased + arcY * arc;

                        if (watchCssCursor) {
                            applyCursorTypeIfNeeded(cursorTypeFromCss(cursorCssFromPoint(cx, cy)));
                        }

                        if (dispatchPointerMoveEvents) {
                            dispatchPointerMoveEvent(cx, cy);
                        }

                        const currentType = el!.dataset.cursorType ?? "default";
                        const config = configs[currentType] ?? {offsetX, offsetY};
                        el!.style.transform = `translate(${cx + config.offsetX}px, ${
                            cy + config.offsetY
                        }px) scale(${scale})`;
                        el!.style.transformOrigin = getTransformOrigin(config);
                        if (t < 1) {
                            requestAnimationFrame(step);
                        } else {
                            resolve(el!.dataset.cursorType ?? null);
                        }
                    }

                    requestAnimationFrame(step);
                });
            },
            {
                fromX,
                fromY,
                toX: x,
                toY: y,
                duration: durationMs,
                offsetX,
                offsetY,
                arcX,
                arcY,
                dispatchPointerMoveEvents,
                scale: this._scale,
                watchCssCursor,
                cssMap: cssCursorTypeMap,
            },
        );
        this._setLocalCursorType(newType);

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
        {
            xOffset = 0,
            yOffset = 0,
            ...options
        }: {xOffset?: number; yOffset?: number} & DemoCursorMoveOptions = {},
    ): Promise<void> {
        const box = await locator.boundingBox();
        if (!box) return;
        await this.moveTo(
            box.x + box.width / 2 + xOffset,
            box.y + box.height / 2 + yOffset,
            durationMs,
            options,
        );
    }

    /**
     * Smoothly animate to `(x, y)` then press and release at that position.
     */
    async click(
        x: number,
        y: number,
        durationMs?: number,
        options?: DemoCursorMoveOptions,
    ): Promise<void> {
        await this.moveTo(x, y, durationMs, options);
        await this._page.mouse.down();
        await this._page.waitForTimeout(cursorClickPressDurationMs);
        await this._page.mouse.up();
    }

    /**
     * Smoothly animate to a natural point inside `locator`, then press and release.
     * Pass `xOffset`/`yOffset` to shift the calculated click point.
     */
    async clickElement(
        locator: Locator,
        durationMs?: number,
        {
            xOffset = 0,
            yOffset = 0,
            ...options
        }: {
            xOffset?: number;
            yOffset?: number;
        } & DemoCursorMoveOptions = {},
    ): Promise<void> {
        const box = await locator.boundingBox();
        if (!box) return;
        const clickPoint = demoCursorClickPointForElement({
            cursorPosition: new Vector2(this._x, this._y),
            rectangle: Rectangle.from(box),
        });
        await this.click(clickPoint.x + xOffset, clickPoint.y + yOffset, durationMs, options);
    }

    /**
     * Inspect the element under the current mouse position and switch to the matching
     * cursor type if it has changed. Called automatically after every `moveTo` and
     * `jumpTo`.
     */
    private async _autoUpdateCursorType(): Promise<void> {
        const newType = await this._page.evaluate(
            ({x, y, cssMap, scale}) => {
                const el = document.getElementById("__demo_cursor__");
                if (!el) return null;
                const configs = JSON.parse(el.dataset.configs ?? "{}");

                function elementForNode(node: Node | null): Element | null {
                    if (!node) return null;
                    if (node.nodeType === Node.ELEMENT_NODE) return node as Element;
                    return node.parentElement;
                }

                function caretElementFromPoint(x: number, y: number): Element | null {
                    const doc = document as Document & {
                        caretPositionFromPoint?: (
                            x: number,
                            y: number,
                        ) => {offsetNode: Node} | null;
                        caretRangeFromPoint?: (x: number, y: number) => Range | null;
                    };
                    const caretPosition = doc.caretPositionFromPoint?.(x, y);
                    if (caretPosition) return elementForNode(caretPosition.offsetNode);
                    const caretRange = doc.caretRangeFromPoint?.(x, y);
                    return elementForNode(caretRange?.startContainer ?? null);
                }

                // Temporarily hide the cursor element so it doesn't occlude the target.
                // (pointer-events:none excludes it from events but not elementFromPoint.)
                const previousVisibility = el.style.visibility;
                el.style.visibility = "hidden";
                const target = document.elementFromPoint(x, y);
                const caretElement = caretElementFromPoint(x, y);
                el.style.visibility = previousVisibility;

                let computedCursor = "default";
                if (target) {
                    computedCursor = getComputedStyle(target).cursor;
                }

                if (computedCursor === "auto" && caretElement) {
                    const caretCursor = getComputedStyle(caretElement).cursor;
                    computedCursor = caretCursor === "auto" ? "text" : caretCursor;
                }

                const parts = computedCursor.split(",");
                const fallbackCursor = parts[parts.length - 1]?.trim() ?? computedCursor;
                const type: string = cssMap[computedCursor] ?? cssMap[fallbackCursor] ?? "default";

                // Only update if the type actually changed to avoid unnecessary DOM writes.
                if (el.dataset.cursorType === type) return type;

                const config = configs[type];
                if (!config) return null;

                el.innerHTML = config.svg;
                el.style.transform = `translate(${x + config.offsetX}px, ${
                    y + config.offsetY
                }px) scale(${scale})`;
                el.style.transformOrigin = `${-config.offsetX}px ${-config.offsetY}px`;
                el.dataset.cursorType = type;
                return type;
            },
            {x: this._x, y: this._y, cssMap: cssCursorTypeMap, scale: this._scale},
        );

        this._setLocalCursorType(newType);
    }

    private _setLocalCursorType(type: string | null): void {
        if (type === "default" || type === "pointer" || type === "text") {
            this._cursorType = type;
        }
    }
}

/**
 * Create and inject a fake mouse cursor into the page for demo recordings. Applies
 * a Quadratic Ease-in-out curve to the cursor movement with a small amount of
 * randomness. Optionally pass in a `randomSeed` to make the cursor movements more
 * deterministic, `scale` to resize the SVG cursor, `watchCssCursor` to update the
 * fake cursor while it moves across CSS cursor boundaries, and
 * `dispatchPointerMoveEvents` to emit synthetic pointer movement during
 * animations.
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
export async function createDemoCursor(
    page: Page,
    optionsOrRandomSeed?: number | DemoCursorOptions,
): Promise<DemoCursor> {
    const cursor = new DemoCursor(page, optionsOrRandomSeed);
    await cursor.setup();
    return cursor;
}

// Algorithm: draw a segment from the current cursor position to the element
// center. The first rectangle edge that segment crosses is the visual "nearest"
// point on the element along the cursor's path. Click 8px farther along the same
// segment, which lands just inside the element instead of jumping to the center.
// Finally clamp to an inset interior rectangle so tiny or diagonal targets still
// produce a valid in-bounds click point.
function demoCursorClickPointForElement({
    cursorPosition,
    rectangle,
}: {
    readonly cursorPosition: Vector2;
    readonly rectangle: Rectangle;
}): Vector2 {
    const center = rectangle.center();

    if (rectangle.width <= 0 || rectangle.height <= 0) {
        return center;
    }

    const xInset = Math.min(cursorElementClickInsetPx, rectangle.width / 2);
    const yInset = Math.min(cursorElementClickInsetPx, rectangle.height / 2);

    function clampToElementInterior(point: Vector2): Vector2 {
        return new Vector2(
            clamp(rectangle.left + xInset, point.x, rectangle.right - xInset),
            clamp(rectangle.top + yInset, point.y, rectangle.bottom - yInset),
        );
    }

    if (rectangle.containsPoint(cursorPosition)) {
        return clampToElementInterior(cursorPosition);
    }

    const path = center.sub(cursorPosition);
    const distance = path.magnitude;
    if (distance === 0) {
        return center;
    }

    const direction = path.div(distance);
    const tolerance = 0.000001;
    const entryCandidates: Array<{point: Vector2; t: number}> = [];

    function considerEntryPoint(t: number, point: Vector2): void {
        if (t < -tolerance || t > 1 + tolerance) return;
        if (point.x < rectangle.left - tolerance || point.x > rectangle.right + tolerance) return;
        if (point.y < rectangle.top - tolerance || point.y > rectangle.bottom + tolerance) return;
        entryCandidates.push({point, t});
    }

    if (path.x !== 0) {
        const leftT = (rectangle.left - cursorPosition.x) / path.x;
        considerEntryPoint(leftT, new Vector2(rectangle.left, cursorPosition.y + path.y * leftT));

        const rightT = (rectangle.right - cursorPosition.x) / path.x;
        considerEntryPoint(
            rightT,
            new Vector2(rectangle.right, cursorPosition.y + path.y * rightT),
        );
    }

    if (path.y !== 0) {
        const topT = (rectangle.top - cursorPosition.y) / path.y;
        considerEntryPoint(topT, new Vector2(cursorPosition.x + path.x * topT, rectangle.top));

        const bottomT = (rectangle.bottom - cursorPosition.y) / path.y;
        considerEntryPoint(
            bottomT,
            new Vector2(cursorPosition.x + path.x * bottomT, rectangle.bottom),
        );
    }

    const entryCandidate = entryCandidates.sort((a, b) => a.t - b.t)[0];
    if (!entryCandidate) {
        return clampToElementInterior(center);
    }

    return clampToElementInterior(
        entryCandidate.point.project(direction, cursorElementClickInsetPx),
    );
}
