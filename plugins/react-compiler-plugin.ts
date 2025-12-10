import babel from "@babel/core";
import BabelPluginReactCompiler from "babel-plugin-react-compiler";

export function reactCompiler(
	options = {} as { filter?: RegExp; reactCompilerConfig?: babel.PluginOptions }
): Bun.BunPlugin {
	const filter = options.filter || /\.[jt]sx$/;
	const reactCompilerConfig = options.reactCompilerConfig || {};

	function b64enc(b: string | Buffer<ArrayBufferLike>) {
		return Buffer.from(b).toString("base64");
	}

	function toUrl(map: babel.BabelFileResult["map"]) {
		return `data:application/json;charset=utf-8;base64,${b64enc(JSON.stringify(map))}`;
	}

	return {
		name: "react-compiler",
		setup({ onLoad }) {
			onLoad({ filter }, async (args) => {
				const input = await Bun.file(args.path).text();
				const result = await babel.transformAsync(input, {
					ast: false,
					babelrc: false,
					configFile: false,
					filename: args.path,
					parserOpts: {
						plugins: ["jsx", "typescript"]
					},
					plugins: [[BabelPluginReactCompiler, reactCompilerConfig]],
					sourceMaps: true
				});
				if (result == null) {
					return { contents: input, loader: "tsx" };
				}
				const { code, map } = result;
				return {
					contents: `${code}\n//# sourceMappingURL=${toUrl(map)}`,
					loader: "tsx"
				};
			});
		}
	};
}

export default reactCompiler;
