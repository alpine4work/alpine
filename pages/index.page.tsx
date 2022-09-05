import Head from "next/head";
import Image, {StaticImageData} from "next/image";
import {useEffect, useState} from "react";
import {ContentEditor, ContentEditorState} from "~/client/content/content-editor";
import {Box} from "~/client/design/box";
import {sprinkles} from "~/client/design/sprinkles.css";
import {ContentSchema} from "~/shared/content/content-schema";
import nebula15Dark from "~/public/nebula/nebula-15-dark.jpg";
import nebula15Light from "~/public/nebula/nebula-15-light.jpg";
import nebula34Dark from "~/public/nebula/nebula-34-dark.jpg";
import nebula34Light from "~/public/nebula/nebula-34-light.jpg";
import {spacing} from "~/shared/design/spacing";
import {useSpacingPx} from "~/client/design/helpers/use-spacing-px";
import {useRemPx} from "~/client/design/helpers/use-rem-px";
import {
    hiddenIfDarkColorSchemeClassName,
    hiddenIfLightColorSchemeClassName,
} from "~/shared/design/color-scheme.css";

function ContentNebulaCoverImage({
    lightSrc,
    darkSrc,
    sizeRem,
    offsetTopRem,
    offsetLeftRem,
    rotationDeg,
}: {
    lightSrc: StaticImageData;
    darkSrc: StaticImageData;
    sizeRem: number;
    offsetTopRem: number;
    offsetLeftRem: number;
    rotationDeg: number;
}) {
    const remPx = useRemPx();
    const sizePx = remPx ? remPx * sizeRem : null;
    const transform = `translateY(-100%) translateY(${offsetTopRem}rem) translateX(-50%) translateX(${offsetLeftRem}rem) rotate(${rotationDeg}deg)`;

    if (!sizePx) return null;

    return (
        <Box
            position="absolute"
            top="0"
            bottom="0"
            left="0"
            right="0"
            overflow="hidden"
            zIndex="-50"
            pointerEvents="none"
        >
            <div
                className={hiddenIfDarkColorSchemeClassName}
                style={{
                    position: "absolute",
                    top: 0,
                    left: "50%",
                    transform,
                    opacity: "30%",
                }}
            >
                <Image
                    layout="fixed"
                    width={sizePx}
                    height={sizePx}
                    quality={100}
                    src={lightSrc}
                    // Decorative image, no alt text.
                    alt=""
                />
            </div>
            <div
                className={hiddenIfLightColorSchemeClassName}
                style={{
                    position: "absolute",
                    top: 0,
                    left: "50%",
                    transform,
                    opacity: "33%",
                }}
            >
                <Image
                    layout="fixed"
                    width={sizePx}
                    height={sizePx}
                    quality={100}
                    src={darkSrc}
                    // Decorative image, no alt text.
                    alt=""
                />
            </div>
        </Box>
    );
}

export default function Home() {
    const [state, setState] = useState(() => ContentEditorState.create());

    useEffect(() => {
        const indexContentJson = localStorage.getItem("indexContentJson");
        if (!indexContentJson) {
            setState(ContentEditorState.create());
        } else {
            setState(
                ContentEditorState.create(ContentSchema.nodeFromJSON(JSON.parse(indexContentJson))),
            );
        }
    }, []);

    const contentCoverImages = {
        nebula1: (
            <ContentNebulaCoverImage
                lightSrc={nebula15Light}
                darkSrc={nebula15Dark}
                sizeRem={155}
                offsetTopRem={36}
                offsetLeftRem={4}
                rotationDeg={70}
            />
        ),
        nebula2: (
            <ContentNebulaCoverImage
                lightSrc={nebula15Light}
                darkSrc={nebula15Dark}
                sizeRem={200}
                offsetTopRem={58}
                offsetLeftRem={4}
                rotationDeg={340}
            />
        ),
        nebula3: (
            <ContentNebulaCoverImage
                lightSrc={nebula15Light}
                darkSrc={nebula15Dark}
                sizeRem={130}
                offsetTopRem={32}
                offsetLeftRem={15}
                rotationDeg={173}
            />
        ),
        nebula4: (
            <ContentNebulaCoverImage
                lightSrc={nebula15Light}
                darkSrc={nebula15Dark}
                sizeRem={170}
                offsetTopRem={49}
                offsetLeftRem={18}
                rotationDeg={290}
            />
        ),
        nebula5: (
            <ContentNebulaCoverImage
                lightSrc={nebula34Light}
                darkSrc={nebula34Dark}
                sizeRem={190}
                offsetTopRem={34}
                offsetLeftRem={4}
                rotationDeg={55}
            />
        ),
        nebula6: (
            <ContentNebulaCoverImage
                lightSrc={nebula34Light}
                darkSrc={nebula34Dark}
                sizeRem={120}
                offsetTopRem={35}
                offsetLeftRem={11}
                rotationDeg={186}
            />
        ),
    };

    return (
        <>
            <Head>
                <title>Cyberworlds</title>
            </Head>
            <main className={sprinkles({height: "full", position: "relative"})}>
                <ContentEditor
                    state={state}
                    onChange={state => {
                        localStorage.setItem(
                            "indexContentJson",
                            JSON.stringify(state.doc.toJSON()),
                        );
                        setState(state);
                    }}
                    aria-label="Content editor"
                    placeholder="Share your ideas…"
                    className={sprinkles({paddingBottom: "24"})}
                />
                {contentCoverImages.nebula6}
            </main>
        </>
    );
}
