const allowedEmailDomain = "@alpine.inc";
const allowedProviders = new Set(["email", "google"]);
const alpineRole = "alpine";

export default {
    userValidate(event) {
        return denyUnlessAllowedUser(event);
    },

    userSignup(event) {
        const denyResponse = denyUnlessAllowedUser(event);
        if (denyResponse) return denyResponse;
        return {user: userWithAlpineRole(event.user)};
    },

    userLogin(event) {
        const denyResponse = denyUnlessAllowedUser(event);
        if (denyResponse) return denyResponse;
        return {user: userWithAlpineRole(event.user)};
    },

    userModified(event) {
        const denyResponse = denyUnlessAllowedUser(event);
        if (denyResponse) return denyResponse;
        return {user: userWithAlpineRole(event.user)};
    },
};

function denyUnlessAllowedUser(event) {
    const email = normalizeEmail(event.user.email);
    if (!email.endsWith(allowedEmailDomain)) {
        return event.deny();
    }

    if (!hasAllowedProvider(event.user)) {
        return event.deny();
    }

    return undefined;
}

function hasAllowedProvider(user) {
    // Netlify invitation links complete through the built-in `email` provider. Google
    // remains the normal sign-in path, but invite-only registration needs the email
    // provider so invited accounts can be created before they receive the `alpine`
    // role.
    if (allowedProviders.has(user.appMetadata?.provider)) return true;
    const providers = user.appMetadata?.providers;
    if (Array.isArray(providers) && providers.some(provider => allowedProviders.has(provider))) {
        return true;
    }
    if (!Array.isArray(user.identities)) return false;
    return user.identities.some(identity => allowedProviders.has(identity.provider));
}

function userWithAlpineRole(user) {
    const roles = new Set(getRoles(user));
    roles.add(alpineRole);

    return {
        ...user,
        appMetadata: {
            ...user.appMetadata,
            roles: Array.from(roles).sort(),
        },
    };
}

function getRoles(user) {
    const roles = user.appMetadata?.roles;
    if (!Array.isArray(roles)) return [];
    return roles.filter(role => typeof role === "string");
}

function normalizeEmail(email) {
    return typeof email === "string" ? email.trim().toLowerCase() : "";
}
