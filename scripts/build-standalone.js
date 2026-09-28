#!/usr/bin/env node
/*
 * Génère une version autonome du replayer : un seul fichier HTML avec le CSS
 * et le JavaScript intégrés (pratique à envoyer ou à héberger n'importe où).
 *
 *   node scripts/build-standalone.js                 -> dist/replayer.html
 *   node scripts/build-standalone.js sortie.html     -> sortie.html
 *   node scripts/build-standalone.js --fragment x    -> sans <html>/<head>/<body>
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const args = process.argv.slice(2);
const fragment = args.includes('--fragment');
const noShare = args.includes('--no-share');
const out = args.find((a) => !a.startsWith('--')) || path.join(ROOT, 'dist', 'replayer.html');

const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const safeScript = (code) => code.replace(/<\/script/gi, '<\\/script');

let html = read('index.html');

html = html.replace(/<link rel="stylesheet" href="(css\/[^"]+)">/g, (_, file) => `<style>\n${read(file)}</style>`);
html = html.replace(/<script src="(js\/[^"]+)"><\/script>/g, (_, file) => `<script>\n${safeScript(read(file))}</script>`);

if (noShare) {
  html = html.replace('<script>', '<script>window.REPLAYER_NO_SHARE = true;</script>\n<script>');
}

if (fragment) {
  html = html
    .replace(/<!doctype html>\s*/i, '')
    .replace(/<html[^>]*>\s*/i, '')
    .replace(/<\/html>\s*/i, '')
    .replace(/<head>\s*/i, '')
    .replace(/<\/head>\s*/i, '')
    .replace(/<body>\s*/i, '')
    .replace(/<\/body>\s*/i, '')
    .replace(/<meta charset="utf-8">\s*/i, '')
    .replace(/<meta name="viewport"[^>]*>\s*/i, '');
}

fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, html);
console.log(`Écrit : ${path.relative(process.cwd(), out)} (${Math.round(html.length / 1024)} Ko)`);
