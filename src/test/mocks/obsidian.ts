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
};