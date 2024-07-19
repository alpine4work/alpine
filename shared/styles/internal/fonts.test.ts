import {parseRemLengthNumber, remPxByPlatform} from "~/shared/design/spacing.js";
import {clamp} from "~/shared/helpers/number/clamp.js";
// eslint-disable-next-line no-restricted-imports
import {fontSizesByPlatform} from "~/shared/styles/internal/styles.js";

test("letter spacing matches Inter tracking formula", () => {
    // Inter formula for letter spacing:
    // https://rsms.me/inter/dynmetrics
    const getTracking = (n: number) => -0.0223 + 0.185 * Math.exp(-0.1745 * n);

    expect(
        Object.fromEntries(
            Object.entries(fontSizesByPlatform).map(([fontSizeName, {desktop, mobile}]) => [
                fontSizeName,
                {
                    desktop: `${Math.round(getTracking(desktop.fontSize) * 1e4) / 1e4}em`,
                    mobile: `${Math.round(getTracking(mobile.fontSize) * 1e4) / 1e4}em`,
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

test("line heights are determined algorithmically from font sizes", () => {
    // Font scale algorithm determined here:
    // https://www.desmos.com/calculator/rewoqdxtac
    const getAveragedLineHeight = (n: number) => clamp(1.2, -0.0115385 * n + 1.66154, 1.5);

    const getLineHeight = (n1: number, n2: number) =>
        Math.round(8 * ((getAveragedLineHeight((n1 + n2) / 2) * n1) / 16)) / 8;

    expect(
        Object.fromEntries(
            Object.entries(fontSizesByPlatform).map(([fontSizeName, {desktop, mobile}]) => [
                fontSizeName,
                {
                    desktop: Math.round(
                        (getLineHeight(desktop.fontSize, mobile.fontSize) *
                            remPxByPlatform.desktop) /
                            (parseRemLengthNumber(desktop.lineHeight) * remPxByPlatform.desktop),
                    ),
                    mobile: Math.round(
                        (getLineHeight(desktop.fontSize, mobile.fontSize) *
                            remPxByPlatform.mobile) /
                            (parseRemLengthNumber(mobile.lineHeight) * remPxByPlatform.mobile),
                    ),
                },
            ]),
        ),
    ).toEqual(
        Object.fromEntries(
            Object.entries(fontSizesByPlatform).map(([fontSizeName]) => [
                fontSizeName,
                {desktop: 1, mobile: 1},
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
