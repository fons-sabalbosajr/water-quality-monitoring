import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, '..');
const read = (relative) => readFileSync(join(SRC, relative), 'utf8');

/**
 * Regression guard for:
 *   "Uncaught Error: useAuth must be used inside an <AuthProvider>."
 *
 * The tree was correctly nested. The crash came from React Fast Refresh: when
 * `createContext()` shares a module with its provider component, editing that
 * module hot-swaps it and re-runs the module body, producing a *new* context
 * object. The mounted provider keeps publishing to the old one while
 * `useContext` reads the new one, so consumers get the default value.
 *
 * The fix is to keep context creation in modules that export no components.
 * These checks are static — they inspect source text rather than rendering —
 * because the failure only reproduces under a bundler's HMR runtime, but the
 * *structural* property that prevents it is easy to assert directly.
 */

const STORE_MODULES = ['context/authStore.js', 'context/themeStore.js'];
const PROVIDER_MODULES = ['context/AuthContext.jsx', 'context/ThemeContext.jsx'];

test('createContext lives only in the component-free store modules', () => {
  STORE_MODULES.forEach((file) => {
    assert.match(read(file), /createContext\(/, `${file} should own its context`);
  });
  PROVIDER_MODULES.forEach((file) => {
    assert.doesNotMatch(
      read(file),
      /createContext\(/,
      `${file} must not create a context — that is what breaks Fast Refresh`,
    );
  });
});

/** Strip comments and string literals so prose/messages are not mistaken for code. */
const stripNonCode = (source) => source
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/^\s*\/\/.*$/gm, '')
  .replace(/'(?:[^'\\]|\\.)*'/g, "''")
  .replace(/"(?:[^"\\]|\\.)*"/g, '""')
  .replace(/`(?:[^`\\]|\\.)*`/g, '``');

test('store modules export no components (JSX or PascalCase)', () => {
  STORE_MODULES.forEach((file) => {
    const source = read(file);
    const code = stripNonCode(source);
    // A component export in these files would make Fast Refresh hot-swap them,
    // reintroducing the stale-context bug. Checked against code only — the
    // files legitimately mention "<AuthProvider>" in comments and messages.
    assert.doesNotMatch(code, /<[A-Za-z][A-Za-z0-9]*[\s/>]/, `${file} must contain no JSX`);
    // Fast Refresh treats an exported PascalCase *function* as a component.
    // A PascalCase object (the context itself) is fine and is the convention,
    // so only function-valued exports are checked here.
    const exportedFunctions = [
      ...code.matchAll(/export\s+const\s+([A-Za-z0-9_]+)\s*=\s*(?:\([^)]*\)|[A-Za-z0-9_]+)\s*=>/g),
      ...code.matchAll(/export\s+function\s+([A-Za-z0-9_]+)/g),
    ].map((m) => m[1]);
    exportedFunctions.forEach((name) => {
      assert.ok(
        !/^[A-Z]/.test(name),
        `${file} exports the PascalCase function "${name}" — Fast Refresh will treat it as a component and hot-swap this module`,
      );
    });
  });
});

test('provider modules re-export nothing that consumers import as a hook', () => {
  // Consumers must import useAuth/useTheme from the store, not the provider —
  // importing through the provider file would put the hook back on a
  // hot-swappable module.
  PROVIDER_MODULES.forEach((file) => {
    const source = read(file);
    assert.doesNotMatch(
      source,
      /export\s+(const|\{)[^\n]*\buse[A-Z]/,
      `${file} must not export a hook`,
    );
  });
});

test('the Fast Refresh lint rule is no longer suppressed in context files', () => {
  [...STORE_MODULES, ...PROVIDER_MODULES].forEach((file) => {
    assert.doesNotMatch(
      read(file),
      /eslint-disable[^\n]*only-export-components/,
      `${file} still disables the rule that prevents this bug`,
    );
  });
});

test('useAuth throws a named error, useTheme degrades gracefully', () => {
  // Auth is a correctness boundary: rendering a protected view without a
  // session must fail loudly rather than silently show an empty page.
  assert.match(read('context/authStore.js'), /throw new Error\(/);
  // A missing theme is only a colour token; charts and the map can legitimately
  // render outside the provider, so it falls back instead of crashing.
  assert.doesNotMatch(read('context/themeStore.js'), /throw new Error\(/);
  assert.match(read('context/themeStore.js'), /theme:\s*'light'/);
});

test('no source file imports the hooks from the provider modules', () => {
  // Catches a future edit that reintroduces the coupling.
  const offenders = [];
  const files = [
    'App.jsx', 'components/ProtectedRoute.jsx', 'pages/Login.jsx',
    'pages/Register.jsx', 'pages/Home.jsx', 'pages/Settings.jsx',
    'pages/WQM2026.jsx', 'pages/Welcome.jsx', 'pages/PublicDashboard.jsx',
    'pages/ChartConfiguration.jsx', 'utils/chartTheme.js',
  ];
  files.forEach((file) => {
    const source = read(file);
    if (/import\s*\{[^}]*\buse(Auth|Theme)\b[^}]*\}\s*from\s*['"][^'"]*\/(Auth|Theme)Context/.test(source)) {
      offenders.push(file);
    }
  });
  assert.deepEqual(offenders, [], 'these import a hook from a provider module');
});
