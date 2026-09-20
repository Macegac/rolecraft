// ESLint for Rolecraft.
//
// The app is classic scripts with no build step: every file in js/ is loaded by index.html in
// order and they all share one global scope, so UIManager in one file is the same UIManager as
// in every other. ESLint has no way to know that on its own — it would call every cross-file
// reference undefined — so the globals are read out of the source at startup, the same way
// tools/check-files.js does it.
//
//   npm run lint          report everything
//   npm run lint:errors   only the things that will actually break, which is what npm test runs
//
// Warnings are style notes. Errors are bugs: a name that does not exist, a duplicate key that
// silently throws half an object away, a condition that can never be true.

import globals from 'globals';
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import url from 'node:url';

const require = createRequire(import.meta.url);
const acorn = require('acorn');
const ROOT = path.dirname(url.fileURLToPath(import.meta.url));

/** Every name declared at the top level of a js/ file, which is every name the app shares. */
function appGlobals() {
    const walk = dir => fs.readdirSync(dir, { withFileTypes: true }).flatMap(e =>
        e.isDirectory() ? walk(path.join(dir, e.name)) : (e.name.endsWith('.js') ? [path.join(dir, e.name)] : []));

    const names = {};
    for (const file of walk(path.join(ROOT, 'js'))) {
        let ast;
        try {
            ast = acorn.parse(fs.readFileSync(file, 'utf8'), { ecmaVersion: 'latest', sourceType: 'script' });
        } catch {
            continue; // a syntax error is check-files.js's job to report, not ours
        }
        for (const node of ast.body) {
            if (node.type === 'VariableDeclaration') {
                for (const d of node.declarations) if (d.id.type === 'Identifier') names[d.id.name] = 'writable';
            } else if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) {
                names[node.id.name] = 'writable';
            }
        }
    }
    return names;
}

// Loaded from a CDN by index.html, so they exist but are not declared anywhere in js/.
const vendor = {
    marked: 'readonly',
    DOMPurify: 'readonly',
    JSZip: 'readonly',
    pako: 'readonly',
    tailwind: 'readonly',
    webkitSpeechRecognition: 'readonly',
};

export default [
    {
        ignores: ['node_modules/**', 'css/tailwind.css', 'electron/**'],
    },
    {
        files: ['js/**/*.js', 'sw.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'script',
            globals: { ...globals.browser, ...globals.serviceworker, ...vendor, ...appGlobals() },
        },
        rules: {
            // Bugs.
            'no-undef': 'error',
            'no-dupe-keys': 'error',
            'no-dupe-args': 'error',
            'no-dupe-class-members': 'error',
            'no-dupe-else-if': 'error',
            'no-duplicate-case': 'error',
            'no-redeclare': ['error', { builtinGlobals: false }],
            'no-unreachable': 'error',
            'no-fallthrough': 'error',
            'no-self-assign': 'error',
            'no-self-compare': 'error',
            'no-unsafe-negation': 'error',
            'no-unsafe-optional-chaining': 'error',
            'no-constant-condition': ['error', { checkLoops: false }],
            'no-constant-binary-expression': 'error',
            'no-async-promise-executor': 'error',
            'no-cond-assign': 'error',
            'no-sparse-arrays': 'error',
            'no-ex-assign': 'error',
            'no-func-assign': 'error',
            'no-import-assign': 'error',
            'no-invalid-regexp': 'error',
            'no-irregular-whitespace': 'error',
            'no-new-native-nonconstructor': 'error',
            'no-obj-calls': 'error',
            'no-setter-return': 'error',
            'no-shadow-restricted-names': 'error',
            'no-this-before-super': 'error',
            'no-compare-neg-zero': 'error',
            'for-direction': 'error',
            'getter-return': 'error',
            'use-isnan': 'error',
            'valid-typeof': 'error',

            // Style notes.
            'no-unused-vars': ['warn', { vars: 'local', args: 'none', caughtErrors: 'none' }],
            'no-empty': ['warn', { allowEmptyCatch: true }],
            'no-case-declarations': 'warn',
            'no-useless-escape': 'warn',
            'no-misleading-character-class': 'warn',
            'no-loss-of-precision': 'warn',

            // Off on purpose for this codebase.
            // `${imgSrc}` appears inside plain strings by design — DOM.html looks for it.
            'no-template-curly-in-string': 'off',
            // Fires on every `el.textContent = x` after an await. All false positives here.
            'require-atomic-updates': 'off',
            'no-prototype-builtins': 'off',
            'no-control-regex': 'off',
            'no-inner-declarations': 'off',
        },
    },
    {
        files: ['tools/**/*.js', 'test.js', 'tailwind.config.js'],
        languageOptions: {
            ecmaVersion: 'latest',
            sourceType: 'commonjs',
            globals: { ...globals.node },
        },
        rules: {
            'no-undef': 'error',
            'no-unused-vars': ['warn', { args: 'none', caughtErrors: 'none' }],
        },
    },
    {
        // Browser tests run Node on the outside and app code on the inside, inside
        // page.evaluate(() => ...), so both sets of names are legitimate here.
        files: ['tools/playwright.test.js'],
        languageOptions: {
            globals: { ...globals.node, ...globals.browser, ...vendor, ...appGlobals() },
        },
    },
];
