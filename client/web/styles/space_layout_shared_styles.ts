export const spaceLayoutErrorRendererPaddingX = "8";
export const spaceLayoutErrorRendererPaddingY = {mobile: "6", desktop: "32"} as const;

// A little bigger than the native iOS toolbar which is around height spacing `10`.
// Spacing `10` just looks squished. In native iOS there's safe area at the bottom
// of the screen which helps make the bottom bar not look squished. We don't have
// that in web mobile so make the tab bar a little bigger.
export const spaceLayoutWebMobileTabBarHeight = "12";
