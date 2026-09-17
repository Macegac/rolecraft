#!/usr/bin/env node
// Verify that index.html and the js/ + css/ folders agree.
//
// The app has no build step: index.html loads every stylesheet and script
// file directly, in order. Because the scripts are classic scripts (not
// modules) they share one global scope, exactly as the old single <script>
// block did. That makes three mistakes easy and silent, so this checks them:
//
//   1. A file on disk that index.html never loads (dead code, or a feature
//      that was added but never wired in).
//   2. A file index.html loads that does not exist (404 on the live site).
//   3. The same top-level name declared in two files (a SyntaxError that
//      stops every later script from running).
//   4. A version stamp (?v=) that no longer matches the file. The service
//      worker serves stamped files from the phone's cache without asking the
//      network, so a stale stamp would keep an old file on every phone.
//
// It also parses every script, so a syntax error fails here instead of on a
// phone.
//
// Usage: node tools/check-files.js     exit 0 = clean, 1 = problems found

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const acorn = require('acorn');

const { stamp } = require('./stamp-versions.js');

const ROOT = path.resolve(__dirname, '..');

function listFiles(dir, ext) {
    const full = path.join(ROOT, dir);
    if (!fs.existsSync(full)) return [];
    return fs.readdirSync(full, { withFileTypes: true }).flatMap(entry => {
        const rel = `${dir}/${entry.name}`;
        if (entry.isDirectory()) return listFiles(rel, ext);
        return entry.name.endsWith(ext) ? [rel] : [];
    });
}

function topLevelNames(ast) {
    const names = [];
    for (const node of ast.body) {
        if (node.type === 'VariableDeclaration') {
            for (const decl of node.declarations) {
                if (decl.id.type === 'Identifier') names.push(decl.id.name);
            }
        } else if ((node.type === 'FunctionDeclaration' || node.type === 'ClassDeclaration') && node.id) {
            names.push(node.id.name);
        }
    }
    return names;
}

function check() {
    const problems = [];
    const html = fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8');

    const loadedScripts = [...html.matchAll(/<script\s+src="(js\/[^"?]+)(?:\?v=[0-9a-f]*)?"/g)].map(m => m[1]);
    const loadedStyles = [...html.matchAll(/<link\s+rel="stylesheet"\s+href="(css\/[^"?]+)(?:\?v=[0-9a-f]*)?"/g)].map(m => m[1]);

    const stamps = stamp(html);
    if (stamps.stale.length) {
        problems.push(`version stamps out of date (run node tools/stamp-versions.js): ${stamps.stale.join(', ')}`);
    }

    const pairs = [
        { kind: 'script', loaded: loadedScripts, onDisk: listFiles('js', '.js') },
        { kind: 'stylesheet', loaded: loadedStyles, onDisk: listFiles('css', '.css') },
    ];
    for (const { kind, loaded, onDisk } of pairs) {
        const seen = new Set();
        for (const file of loaded) {
            if (seen.has(file)) problems.push(`${kind} loaded twice by index.html: ${file}`);
            seen.add(file);
            if (!onDisk.includes(file)) problems.push(`index.html loads a ${kind} that does not exist: ${file}`);
        }
        for (const file of onDisk) {
            if (!seen.has(file)) problems.push(`${kind} is never loaded by index.html: ${file}`);
        }
    }

    const owner = new Map();
    for (const file of loadedScripts) {
        const full = path.join(ROOT, file);
        if (!fs.existsSync(full)) continue;
        let ast;
        try {
            ast = acorn.parse(fs.readFileSync(full, 'utf8'), { ecmaVersion: 'latest', sourceType: 'script' });
        } catch (e) {
            problems.push(`syntax error in ${file}: ${e.message}`);
            continue;
        }
        for (const name of topLevelNames(ast)) {
            if (owner.has(name)) problems.push(`"${name}" is declared in both ${owner.get(name)} and ${file}`);
            else owner.set(name, file);
        }
    }

    return { problems, scripts: loadedScripts.length, styles: loadedStyles.length, names: owner.size };
}

if (require.main === module) {
    const { problems, scripts, styles, names } = check();
    console.log(`Scripts: ${scripts}  |  Stylesheets: ${styles}  |  Top-level names: ${names}  |  Problems: ${problems.length}`);
    for (const p of problems) console.log(`  - ${p}`);
    process.exit(problems.length ? 1 : 0);
}

module.exports = { check };
