import {
    convertRemLengthToPx,
    parseRemLengthNumber,
    remPxByPlatform,
} from "~/shared/design/spacing.js";
import {fontSizesByPlatform} from "~/shared/styles/styles.js";

test("letter spacing matches Inter tracking formula", () => {
    // Inter formula for letter spacing:
    // https://rsms.me/inter/dynmetrics
    const getTracking = (n: number) => -0.0223 + 0.185 * Math.exp(-0.1745 * n);

    expect(
        Object.fromEntries(
            Object.entries(fontSizesByPlatform).map(([fontSizeName, {desktop, mobile}]) => [
                fontSizeName,
                {
                    desktop: `${Math.round(getTracking(desktop.fontSize) * 1000) / 1000}em`,
                    mobile:
                        // Special case for 13. It's the only tracking value not rounded to 3 places
                        // on https://rsms.me/inter/dynmetrics
                        mobile.fontSize === 13
                            ? "-0.0025em"
                            : `${Math.round(getTracking(mobile.fontSize) * 1000) / 1000}em`,
                },
            ]),
        ),
    ).toEqual(
        Object.fromEntries(
            Object.entries(fontSizesByPlatform).map(([fontSizeName, {desktop, mobile}]) => [
                fontSizeName,
                {desktop: desktop.letterSpacing, mobile: mobile.letterSpacing},
            ]),
        ),
    );
});

test("line height is the same across platforms", () => {
    expect(
        Object.fromEntries(
            Object.entries(fontSizesByPlatform).map(([fontSizeName, {desktop}]) => [
                fontSizeName,
                desktop.lineHeight,
            ]),
        ),
    ).toEqual(
        Object.fromEntries(
            Object.entries(fontSizesByPlatform).map(([fontSizeName, {mobile}]) => [
                fontSizeName,
                mobile.lineHeight,
            ]),
        ),
    );
});

test("line heights are a multiple of 8", () => {
    expect(
        Object.fromEntries(
            Object.entries(fontSizesByPlatform).map(([fontSizeName, {desktop, mobile}]) => [
                fontSizeName,
                {
                    desktop: `${Math.round(parseRemLengthNumber(desktop.lineHeight) * 8) / 8}rem`,
                    mobile: `${Math.round(parseRemLengthNumber(mobile.lineHeight) * 8) / 8}rem`,
                },
            ]),
        ),
    ).toEqual(
        Object.fromEntries(
            Object.entries(fontSizesByPlatform).map(([fontSizeName, {desktop, mobile}]) => [
                fontSizeName,
                {desktop: desktop.lineHeight, mobile: mobile.lineHeight},
            ]),
        ),
    );
});

test("line heights are approximately 1.3x font sizes", () => {
    expect(
        Object.fromEntries(
            Object.entries(fontSizesByPlatform).map(([fontSizeName, {desktop, mobile}]) => [
                fontSizeName,
                {
                    desktop: String(
                        Math.round(
                            (convertRemLengthToPx(desktop.lineHeight, remPxByPlatform.desktop) /
                                desktop.fontSize) *
                                10,
                        ) / 10,
                    ),
                    mobile: String(
                        Math.round(
                            (convertRemLengthToPx(mobile.lineHeight, remPxByPlatform.mobile) /
                                mobile.fontSize) *
                                10,
                        ) / 10,
                    ),
                },
            ]),
        ),
    ).toEqual(
        Object.fromEntries(
            Object.entries(fontSizesByPlatform).map(([fontSizeName]) => [
                fontSizeName,
                {desktop: "1.3", mobile: expect.stringMatching(/^1\.3|1\.4$/)},
            ]),
        ),
    );
});

test("mobile font sizes are approximately 1.25x desktop font sizes", () => {
    expect(
        Object.fromEntries(
            Object.entries(fontSizesByPlatform).map(([fontSizeName, {desktop, mobile}]) => [
                fontSizeName,
                Math.round((mobile.fontSize / desktop.fontSize) * 4) / 4,
            ]),
        ),
    ).toEqual(
        Object.fromEntries(
            Object.entries(fontSizesByPlatform).map(([fontSizeName]) => [fontSizeName, 1.25]),
        ),
    );
});
