import {fontSizesBySpacingScale} from "~/shared/design/core/fonts.js";
import {parseRemLength} from "~/shared/design/core/spacing.js";
import {remPxBySpacingScale} from "~/shared/design/core/spacing_scale.js";
import {clamp} from "~/shared/helpers/number/clamp.js";

test("letter spacing matches Inter tracking formula", () => {
    // Inter formula for letter spacing: https://rsms.me/inter/dynmetrics
    const getTracking = (n: number) => -0.0223 + 0.185 * Math.exp(-0.1745 * n);

    expect(
        Object.fromEntries(
            Object.entries(fontSizesBySpacingScale).map(
                ([fontSizeName, {small, medium, large}]) => [
                    fontSizeName,
                    {
                        small: `${Math.round(getTracking(small.fontSize) * 1e4) / 1e4}em`,
                        medium: `${Math.round(getTracking(medium.fontSize) * 1e4) / 1e4}em`,
                        large: `${Math.round(getTracking(large.fontSize) * 1e4) / 1e4}em`,
                    },
                ],
            ),
        ),
    ).toEqual(
        Object.fromEntries(
            Object.entries(fontSizesBySpacingScale).map(
                ([fontSizeName, {small, medium, large}]) => [
                    fontSizeName,
                    {
                        small: small.letterSpacing,
                        medium: medium.letterSpacing,
                        large: large.letterSpacing,
                    },
                ],
            ),
        ),
    );
});

test("line height is the same across platforms", () => {
    expect(
        Object.fromEntries(
            Object.entries(fontSizesBySpacingScale).map(([fontSizeName, {small}]) => [
                fontSizeName,
                small.lineHeight,
            ]),
        ),
    ).toEqual(
        Object.fromEntries(
            Object.entries(fontSizesBySpacingScale).map(([fontSizeName, {large}]) => [
                fontSizeName,
                large.lineHeight,
            ]),
        ),
    );

    expect(
        Object.fromEntries(
            Object.entries(fontSizesBySpacingScale).map(([fontSizeName, {small}]) => [
                fontSizeName,
                small.lineHeight,
            ]),
        ),
    ).toEqual(
        Object.fromEntries(
            Object.entries(fontSizesBySpacingScale).map(([fontSizeName, {medium}]) => [
                fontSizeName,
                medium.lineHeight,
            ]),
        ),
    );
});

test("line heights are a multiple of 8", () => {
    expect(
        Object.fromEntries(
            Object.entries(fontSizesBySpacingScale).map(
                ([fontSizeName, {small, medium, large}]) => [
                    fontSizeName,
                    {
                        small: `${Math.round(parseRemLength(small.lineHeight) * 8) / 8}rem`,
                        medium: `${Math.round(parseRemLength(medium.lineHeight) * 8) / 8}rem`,
                        large: `${Math.round(parseRemLength(large.lineHeight) * 8) / 8}rem`,
                    },
                ],
            ),
        ),
    ).toEqual(
        Object.fromEntries(
            Object.entries(fontSizesBySpacingScale).map(
                ([fontSizeName, {small, medium, large}]) => [
                    fontSizeName,
                    {
                        small: small.lineHeight,
                        medium: medium.lineHeight,
                        large: large.lineHeight,
                    },
                ],
            ),
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
            Object.entries(fontSizesBySpacingScale).map(
                ([fontSizeName, {small, medium, large}]) => [
                    fontSizeName,
                    {
                        small: Math.round(
                            (getLineHeight(small.fontSize, large.fontSize) *
                                remPxBySpacingScale.small) /
                                (parseRemLength(small.lineHeight) * remPxBySpacingScale.small),
                        ),
                        medium: Math.round(
                            (getLineHeight(small.fontSize, medium.fontSize) *
                                remPxBySpacingScale.medium) /
                                (parseRemLength(medium.lineHeight) * remPxBySpacingScale.medium),
                        ),
                        large: Math.round(
                            (getLineHeight(small.fontSize, large.fontSize) *
                                remPxBySpacingScale.large) /
                                (parseRemLength(large.lineHeight) * remPxBySpacingScale.large),
                        ),
                    },
                ],
            ),
        ),
    ).toEqual(
        Object.fromEntries(
            Object.entries(fontSizesBySpacingScale).map(([fontSizeName]) => [
                fontSizeName,
                {small: 1, medium: 1, large: 1},
            ]),
        ),
    );
});

test("large font sizes are approximately 1.25x small font sizes", () => {
    expect(
        Object.fromEntries(
            Object.entries(fontSizesBySpacingScale).map(([fontSizeName, {small, large}]) => [
                fontSizeName,
                Math.round((large.fontSize / small.fontSize) * 4) / 4,
            ]),
        ),
    ).toEqual(
        Object.fromEntries(
            Object.entries(fontSizesBySpacingScale).map(([fontSizeName]) => [fontSizeName, 1.25]),
        ),
    );
});

test("medium font sizes are approximately 1.125x small font sizes", () => {
    expect(
        Object.fromEntries(
            Object.entries(fontSizesBySpacingScale).map(([fontSizeName, {small, medium}]) => [
                fontSizeName,
                Math.round((medium.fontSize / small.fontSize) * 8) / 8,
            ]),
        ),
    ).toEqual(
        Object.fromEntries(
            Object.entries(fontSizesBySpacingScale).map(([fontSizeName]) => [fontSizeName, 1.125]),
        ),
    );
});
