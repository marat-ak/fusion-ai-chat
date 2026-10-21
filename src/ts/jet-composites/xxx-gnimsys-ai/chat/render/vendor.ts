declare const require: any;

const MODULES = {
  "markdown-it": "xxx-gnimsys-ai/libs/markdown-it.min",
  purify: "xxx-gnimsys-ai/libs/purify.min",
} as const;

export function loadVendor(name: "markdown-it" | "purify"): Promise<unknown> {
  return new Promise<unknown>((resolve, reject) => {
    require([MODULES[name]], (mod: unknown) => {
      if (mod === undefined || mod === null) reject(new Error("vendor " + name + " did not export"));
      else resolve(mod);
    }, reject);
  });
}
