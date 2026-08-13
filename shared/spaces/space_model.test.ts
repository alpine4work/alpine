import {createTestAvatarModel} from "~/shared/avatar/test_helpers/avatar_model_test_helpers.js";
import {generateChronologicalId} from "~/shared/id/chronological_id.open_source.js";
import {AvatarId} from "~/shared/id/types/id_types.js";
import {SpaceModel} from "~/shared/spaces/space_model.js";
import {createTestSpaceModel} from "~/shared/spaces/test_helpers/space_model_test_helpers.js";

const darkThemeAvatar1 = generateChronologicalId<AvatarId>();
const lightThemeAvatar1 = generateChronologicalId<AvatarId>();
const darkThemeAvatar2 = generateChronologicalId<AvatarId>();
const lightThemeAvatar2 = generateChronologicalId<AvatarId>();

describe("merge", () => {
    test("returns space1 when space1 has higher version and same/newer avatars", () => {
        const space1 = createTestSpaceModel({
            name: "Space 1",
            version: 2,
            avatars: {
                darkTheme: createTestAvatarModel({version: 3}),
                lightTheme: createTestAvatarModel({version: 3}),
            },
        });
        const space2 = createTestSpaceModel({
            name: "Space 2",
            version: 1,
            avatars: {
                darkTheme: createTestAvatarModel({version: 2}),
                lightTheme: createTestAvatarModel({version: 2}),
            },
        });

        const result = SpaceModel.merge(space1, space2);

        expect(result).toBe(space1);
    });

    test("returns space2 when space2 has higher version and same/newer avatars", () => {
        const space1 = createTestSpaceModel({
            name: "Space 1",
            version: 1,
            avatars: {
                darkTheme: createTestAvatarModel({version: 2}),
                lightTheme: createTestAvatarModel({version: 2}),
            },
        });
        const space2 = createTestSpaceModel({
            name: "Space 2",
            version: 2,
            avatars: {
                darkTheme: createTestAvatarModel({version: 3}),
                lightTheme: createTestAvatarModel({version: 3}),
            },
        });

        const result = SpaceModel.merge(space1, space2);

        expect(result).toBe(space2);
    });

    test("returns space1 when versions are equal and space1 has newer avatars", () => {
        const space1 = createTestSpaceModel({
            name: "Space 1",
            version: 1,
            avatars: {
                darkTheme: createTestAvatarModel({version: 3}),
                lightTheme: createTestAvatarModel({version: 3}),
            },
        });
        const space2 = createTestSpaceModel({
            name: "Space 2",
            version: 1,
            avatars: {
                darkTheme: createTestAvatarModel({version: 2}),
                lightTheme: createTestAvatarModel({version: 2}),
            },
        });

        const result = SpaceModel.merge(space1, space2);

        expect(result).toBe(space1);
    });

    test("returns space1 when versions are equal and space1 has same avatars", () => {
        const space1 = createTestSpaceModel({
            name: "Space 1",
            version: 1,
            avatars: {
                darkTheme: createTestAvatarModel({version: 2}),
                lightTheme: createTestAvatarModel({version: 2}),
            },
        });
        const space2 = createTestSpaceModel({
            name: "Space 2",
            version: 1,
            avatars: {
                darkTheme: createTestAvatarModel({version: 2}),
                lightTheme: createTestAvatarModel({version: 2}),
            },
        });

        const result = SpaceModel.merge(space1, space2);

        expect(result).toBe(space1);
    });

    test("creates new SpaceModel when merging is required", () => {
        const space1 = createTestSpaceModel({
            name: "Space 1",
            version: 2,
            avatars: {
                darkTheme: createTestAvatarModel({version: 1, avatarId: darkThemeAvatar1}),
                lightTheme: createTestAvatarModel({version: 1, avatarId: lightThemeAvatar1}),
            },
        });
        const space2 = createTestSpaceModel({
            name: "Space 2",
            version: 1,
            avatars: {
                darkTheme: createTestAvatarModel({version: 3, avatarId: darkThemeAvatar2}),
                lightTheme: createTestAvatarModel({version: 3, avatarId: lightThemeAvatar2}),
            },
        });

        const result = SpaceModel.merge(space1, space2);

        expect(result).not.toBe(space1);
        expect(result).not.toBe(space2);
        expect(result).toEqual(
            new SpaceModel({
                id: space1.id,
                name: space1.name,
                version: space1.version,
                themeColor: space1.themeColor,
                avatars: {
                    darkTheme: createTestAvatarModel({
                        version: 3,
                        avatarId: darkThemeAvatar2,
                    }),
                    lightTheme: createTestAvatarModel({
                        version: 3,
                        avatarId: lightThemeAvatar2,
                    }),
                },
            }),
        );
    });

    test("merges space data from higher version space with latest avatars", () => {
        const space1 = createTestSpaceModel({
            name: "Space 1",
            version: 2,
            avatars: {
                darkTheme: createTestAvatarModel({version: 1, avatarId: darkThemeAvatar1}),
                lightTheme: createTestAvatarModel({version: 1, avatarId: lightThemeAvatar1}),
            },
        });
        const space2 = createTestSpaceModel({
            name: "Space 2",
            version: 1,
            avatars: {
                darkTheme: createTestAvatarModel({version: 3, avatarId: darkThemeAvatar2}),
                lightTheme: createTestAvatarModel({version: 3, avatarId: lightThemeAvatar2}),
            },
        });

        const result = SpaceModel.merge(space1, space2);

        expect(result).toEqual(
            new SpaceModel({
                id: space1.id,
                name: space1.name,
                version: space1.version,
                themeColor: space1.themeColor,
                avatars: {
                    darkTheme: createTestAvatarModel({version: 3, avatarId: darkThemeAvatar2}),
                    lightTheme: createTestAvatarModel({
                        version: 3,
                        avatarId: lightThemeAvatar2,
                    }),
                },
            }),
        );
    });

    test("handles null avatars correctly", () => {
        const space1 = createTestSpaceModel({
            version: 2,
            avatars: {
                darkTheme: createTestAvatarModel({avatarId: null, content: null, version: 0}),
                lightTheme: createTestAvatarModel({version: 2, avatarId: lightThemeAvatar2}),
            },
        });
        const space2 = createTestSpaceModel({
            version: 1,
            avatars: {
                darkTheme: createTestAvatarModel({version: 3, avatarId: darkThemeAvatar2}),
                lightTheme: createTestAvatarModel({avatarId: null, content: null, version: 0}),
            },
        });

        const result = SpaceModel.merge(space1, space2);

        expect(result).toEqual(
            new SpaceModel({
                id: space1.id,
                name: space1.name,
                version: space1.version,
                themeColor: space1.themeColor,
                avatars: {
                    darkTheme: createTestAvatarModel({version: 3, avatarId: darkThemeAvatar2}),
                    lightTheme: createTestAvatarModel({
                        avatarId: lightThemeAvatar2,
                        version: 2,
                    }),
                },
            }),
        );
    });

    test("handles both avatars are null", () => {
        const space1 = createTestSpaceModel({
            version: 2,
            avatars: {
                darkTheme: createTestAvatarModel({avatarId: null, content: null, version: 0}),
                lightTheme: createTestAvatarModel({avatarId: null, content: null, version: 0}),
            },
        });
        const space2 = createTestSpaceModel({
            version: 1,
            avatars: {
                darkTheme: createTestAvatarModel({avatarId: null, content: null, version: 0}),
                lightTheme: createTestAvatarModel({avatarId: null, content: null, version: 0}),
            },
        });

        const result = SpaceModel.merge(space1, space2);

        expect(result).toBe(space1);
    });

    describe("avatar version comparison edge cases", () => {
        test("handles mixed avatar scenarios", () => {
            const space1 = createTestSpaceModel({
                version: 2,
                avatars: {
                    darkTheme: createTestAvatarModel({version: 1, avatarId: darkThemeAvatar1}),
                    lightTheme: createTestAvatarModel({version: 3, avatarId: lightThemeAvatar2}),
                },
            });
            const space2 = createTestSpaceModel({
                version: 1,
                avatars: {
                    darkTheme: createTestAvatarModel({version: 2, avatarId: darkThemeAvatar2}),
                    lightTheme: createTestAvatarModel({version: 1, avatarId: lightThemeAvatar1}),
                },
            });

            const result = SpaceModel.merge(space1, space2);
            expect(result).toEqual(
                new SpaceModel({
                    id: space1.id,
                    name: space1.name,
                    version: space1.version,
                    themeColor: space1.themeColor,
                    avatars: {
                        darkTheme: createTestAvatarModel({version: 2, avatarId: darkThemeAvatar2}),
                        lightTheme: createTestAvatarModel({
                            version: 3,
                            avatarId: lightThemeAvatar2,
                        }),
                    },
                }),
            );
        });

        test("handles one space having null avatar and other having avatar", () => {
            const space1 = createTestSpaceModel({
                version: 2,
                avatars: {
                    darkTheme: createTestAvatarModel({avatarId: null, content: null, version: 0}),
                    lightTheme: createTestAvatarModel({version: 2, avatarId: lightThemeAvatar1}),
                },
            });
            const space2 = createTestSpaceModel({
                version: 1,
                avatars: {
                    darkTheme: createTestAvatarModel({version: 1, avatarId: darkThemeAvatar1}),
                    lightTheme: createTestAvatarModel({avatarId: null, content: null, version: 0}),
                },
            });

            const result = SpaceModel.merge(space1, space2);

            // space1 data (higher version) but with merged avatars
            expect(result).toEqual(
                new SpaceModel({
                    id: space1.id,
                    name: space1.name,
                    version: space1.version,
                    themeColor: space1.themeColor,
                    avatars: {
                        darkTheme: createTestAvatarModel({version: 1, avatarId: darkThemeAvatar1}),
                        lightTheme: createTestAvatarModel({
                            version: 2,
                            avatarId: lightThemeAvatar1,
                        }),
                    },
                }),
            );
        });
    });

    test("handles identical spaces", () => {
        const spaceData = {
            name: "Identical Space",
            version: 1,
            darkThemeAvatar: createTestAvatarModel({version: 1}),
            lightThemeAvatar: createTestAvatarModel({version: 1}),
        };
        const space1 = createTestSpaceModel(spaceData);
        const space2 = createTestSpaceModel(spaceData);

        const result = SpaceModel.merge(space1, space2);

        expect(result).toBe(space1); // Should return space1 due to tie-breaking
    });

    test("handles version 0 spaces", () => {
        const space1 = createTestSpaceModel({
            version: 0,
            avatars: {
                darkTheme: createTestAvatarModel({version: 1, avatarId: darkThemeAvatar2}),
                lightTheme: createTestAvatarModel({avatarId: null, content: null, version: 0}),
            },
        });
        const space2 = createTestSpaceModel({
            version: 1,
            avatars: {
                darkTheme: createTestAvatarModel({version: 0, avatarId: darkThemeAvatar1}),
                lightTheme: createTestAvatarModel({avatarId: null, content: null, version: 0}),
            },
        });

        const result = SpaceModel.merge(space1, space2);

        expect(result).toEqual(
            new SpaceModel({
                id: space2.id,
                name: space2.name,
                version: space2.version,
                themeColor: space2.themeColor,
                avatars: {
                    darkTheme: createTestAvatarModel({version: 1, avatarId: darkThemeAvatar2}),
                    lightTheme: createTestAvatarModel({
                        avatarId: null,
                        content: null,
                        version: 0,
                    }),
                },
            }),
        );
    });
});
