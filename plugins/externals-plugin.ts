/**
 * Plugin to mock external packages that aren't needed in production
 */
export function externalsPlugin(): Bun.BunPlugin {
	return {
		name: "externals-mock",
		setup(build) {
			// Mock react-devtools-core - it's only used for development debugging in ink
			build.onResolve({ filter: /^react-devtools-core$/ }, () => {
				return {
					namespace: "externals-mock",
					path: "react-devtools-core"
				};
			});

			build.onLoad({ filter: /.*/, namespace: "externals-mock" }, () => {
				return {
					contents:
						"export default {}; export const connectToDevTools = () => {};",
					loader: "js"
				};
			});
		}
	};
}

export default externalsPlugin;
