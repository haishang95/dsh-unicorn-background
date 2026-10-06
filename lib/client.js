window.__ModuleLoader__.load({
	id: "dsh-unicorn-background",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

		/**
		 * Client half: load the browser half. That script owns both the painting and
		 * the settings panel, and it replaces any instance it finds, so re-injecting
		 * is how an edit to it reaches an already-open page.
		 *
		 * Bump VERSION whenever `assets/wallpaper.js` changes.
		 */
		const SCRIPT_PATH = "/dsh-user-background/wallpaper.js";
		const VERSION = "6";
		const MARK = "__dshUserBackgroundScript";

		function load() {
			try {
				window[MARK] = true;
				const tag = document.createElement("script");
				tag.src = `${SCRIPT_PATH}?v=${VERSION}`;
				tag.async = true;
				tag.onerror = () => {
					window[MARK] = false;
				};
				(document.body || document.head || document.documentElement).appendChild(tag);
			} catch {
				window[MARK] = false;
			}
		}

		function unload() {
			try {
				window[MARK] = false;
				const current = window.__dshUserBackground;
				if (current && typeof current.dispose === "function") current.dispose();
			} catch {
				/* the page may already be tearing down */
			}
		}

		const inject = [];

		/**
		 * @param ctx - client root context.
		 */
		function apply(ctx) {
			ctx.effect(() => {
				load();
				return () => {
					unload();
				};
			}, "dsh-unicorn-background: browser half");
		}

		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	},
});
