// This configuration only applies to the package manager root.
module.exports = {
	root: true,
	ignorePatterns: ["apps/**", "packages/**"],
	extends: ["@repo/eslint-config"]
};
