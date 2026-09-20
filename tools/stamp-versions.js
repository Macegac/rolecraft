#!/usr/bin/env node
// Stamp every stylesheet and script tag in index.html with a version taken from
// the file's contents: <script src="js/boot.js?v=3f9a12c4e1">.
//
// Why: the service worker serves a stamped file straight from the phone's cache
// with no network trip, because a changed file always gets a new stamp and so a
// new address. Startup then costs one request (index.html) instead of one per
// file, and old and new files can still never mix.
//
// It also writes js/core/build-info.js, the version line shown in Settings and at the top of
// every problem report. That line used to be typed by hand, so it went on saying
// "1.1.0 (2026.08.30 - 12:26)" long after that stopped being true. It is now the version from
// package.json plus a short build number taken from the contents of every script and
// stylesheet, so it changes exactly when the app changes — which is the only question that
// line is ever asked: is this phone running the same code as everyone else?
//
// Usage:
//   node tools/stamp-versions.js           rewrite index.html with current stamps
//   node tools/stamp-versions.js --check   exit 1 if any stamp is out of date

'use strict';

const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const ROOT = path.resolve(__dirname, '..');
const INDEX = path.join(ROOT, 'index.html');
const BUILD_INFO_FILE = 'js/core/build-info.js';

// Matches <script src="js/..."> and <link rel="stylesheet" href="css/...">, with or without ?v=.
const TAG = /(<script\s+src="|<link\s+rel="stylesheet"\s+href=")((?:js|css)\/[^"?]+)(?:\?v=([0-9a-f]*))?"/g;

function versionOf(file) {
    const bytes = fs.readFileSync(path.join(ROOT, file));
    return crypto.createHash('sha256').update(bytes).digest('hex').slice(0, 10);
}

/**
 * The version line for Settings and the problem report. The build number covers every script
 * and stylesheet except build-info.js itself, which would otherwise change its own input.
 *
 * @param {string} html - index.html, which lists the files that make up the app.
 * @returns {string} the contents build-info.js should have.
 */
function buildInfo(html) {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8'));
    const files = [...html.matchAll(TAG)]
        .map(m => m[2])
        .filter(f => f !== BUILD_INFO_FILE && fs.existsSync(path.join(ROOT, f)))
        .sort();
    const digest = crypto.createHash('sha256');
    for (const file of files) digest.update(file).update(fs.readFileSync(path.join(ROOT, file)));
    const build = digest.digest('hex').slice(0, 8);

    return `        /**
         * Application build information — written by tools/stamp-versions.js.
         * Do not edit by hand: change the version in package.json instead. The build number
         * is taken from the contents of every script and stylesheet, so two people seeing the
         * same number are running exactly the same app.
         */
        const APP_BUILD_TIMESTAMP = "Rolecraft ${pkg.version} (build ${build})";
`;
}

/**
 * @param {string} html
 * @returns {{html: string, stale: string[], missing: string[]}}
 */
function stamp(html) {
    const stale = [];
    const missing = [];
    const out = html.replace(TAG, (match, opener, file, current) => {
        if (!fs.existsSync(path.join(ROOT, file))) {
            missing.push(file);
            return match;
        }
        const version = versionOf(file);
        if (current !== version) stale.push(file);
        return `${opener}${file}?v=${version}"`;
    });
    return { html: out, stale, missing };
}

if (require.main === module) {
    const check = process.argv.includes('--check');
    const html = fs.readFileSync(INDEX, 'utf8');

    // build-info.js first: it is one of the stamped files, so index.html must be stamped
    // against its new contents, not its old ones.
    const infoPath = path.join(ROOT, BUILD_INFO_FILE);
    const wantedInfo = buildInfo(html);
    const currentInfo = fs.existsSync(infoPath) ? fs.readFileSync(infoPath, 'utf8') : '';
    const infoStale = currentInfo !== wantedInfo;
    if (infoStale && !check) fs.writeFileSync(infoPath, wantedInfo);

    const result = stamp(fs.readFileSync(INDEX, 'utf8'));
    if (check) {
        const stale = [...result.stale, ...(infoStale ? [BUILD_INFO_FILE] : [])];
        if (stale.length) {
            console.log(`Version stamps out of date for ${stale.length} file(s): ${stale.join(', ')}`);
            console.log('Run: node tools/stamp-versions.js');
            process.exit(1);
        }
        console.log('Version stamps: all current');
    } else {
        if (result.html !== html) fs.writeFileSync(INDEX, result.html);
        const updated = result.stale.length + (infoStale ? 1 : 0);
        console.log(`Version stamps: ${updated} updated`);
    }
}

module.exports = { stamp, versionOf, buildInfo, TAG, BUILD_INFO_FILE };
