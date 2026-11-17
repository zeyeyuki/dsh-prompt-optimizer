/**
 * Host half of the prompt-optimizer bundle.
 *
 * Everything this plugin does happens in the browser: the composer-side button,
 * the right-Sidebar panel, and the offline rule engine all live in `client.js`.
 * The Host row exists only so the bundle is a loadable plugin, and so the Client
 * module declared by `package.json`'s `dsh.client` section is served.
 */
export function apply() {}