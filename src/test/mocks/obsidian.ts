/**
 * Vitest alias for the "obsidian" package.
 *
 * The real `obsidian` module is only resolved inside Obsidian at runtime; its
 * package entry (main/manifest) cannot be resolved by Vite under Node, so tests
 * that transitively import it would otherwise fail with
 * "Failed to resolve entry for package 'obsidian'". This mock supplies the few
 * runtime symbols the tested modules access. Keep it minimal and mirror the
 * real API surface that tests rely on; add members only as needed.
 */
export const Platform = {
  isDesktop: true,
  isMobile: false,
  isMobileApp: false,
  isDesktopApp: true,
  isAndroidApp: false,
  isIosApp: false,
};

export const requireApiVersion = (_ver: string): boolean => true;

export const normalizePath = (path: string): string => path;

export const moment = (x?: number | string | Date) => {
  const d = x === undefined ? new Date() : new Date(x);
  return {
    format: (_fmt?: string): string => d.toISOString(),
  };
};
moment.locale = (): string => "en";

export class TAbstractFile {
  path = "";
  name = "";
  vault: Vault = new Vault();
}

export class TFile extends TAbstractFile {
  stat = { ctime: 0, mtime: 0, size: 0 };
  extension = "md";
}

export class TFolder extends TAbstractFile {}

export class Vault {}

export const requestUrl = (): Promise<never> => {
  return Promise.reject(new Error("requestUrl is not available in tests"));
};
