// Canonical identity for the managed penggin/gsd-pi-herdr distribution.
// Runtime network operations must use these values rather than inherited
// source-project endpoints. Historical attribution remains in documentation/git.
export const GSD_DISTRIBUTION_PACKAGE = "@penggin/gsd-pi-herdr";
export const GSD_DISTRIBUTION_REPOSITORY = "penggin/gsd-pi-herdr";
export const GSD_DISTRIBUTION_REPOSITORY_URL = `https://github.com/${GSD_DISTRIBUTION_REPOSITORY}`;
export const GSD_DISTRIBUTION_ISSUES_URL = `${GSD_DISTRIBUTION_REPOSITORY_URL}/issues`;
export const GSD_DISTRIBUTION_RELEASES_API = `https://api.github.com/repos/${GSD_DISTRIBUTION_REPOSITORY}/releases?per_page=100`;
export const GSD_DISTRIBUTION_MODELS_CATALOG_URL = `https://raw.githubusercontent.com/${GSD_DISTRIBUTION_REPOSITORY}/main/packages/pi-ai/src/models.generated.json`;
export const GSD_DISTRIBUTION_REGISTRY_URL = "https://registry.npmjs.org/@penggin%2fgsd-pi-herdr/latest";
