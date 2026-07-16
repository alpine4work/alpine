export type BlogAuthorId = "josh" | "caleb" | "rachel" | "ian";

export type BlogAuthorSocials = {
    x: string | null;
    bluesky: string | null;
    linkedin: string | null;
    email: string | null;
};

export type BlogAuthor = {
    id: BlogAuthorId;
    name: string;
    socials: BlogAuthorSocials;
    avatarUrl: string;
};

export type BlogAuthorById = Record<BlogAuthorId, BlogAuthor>;
