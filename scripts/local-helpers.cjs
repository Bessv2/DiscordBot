// Pure helpers for scripts/local.cjs, kept separate so they can be unit
// tested (tests/localLauncher.test.ts) without running the launcher.
'use strict';

const MIN_NODE = [22, 12, 0];

/** True when a version string like "v22.12.0" is at least MIN_NODE. */
function nodeVersionOk(version, min = MIN_NODE) {
  const parts = String(version).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const have = parts[i] || 0;
    if (have !== min[i]) return have > min[i];
  }
  return true;
}

/** The value of KEY in .env text, without quotes; '' when missing or blank. */
function readEnvValue(text, key) {
  const re = new RegExp(`^[ \\t]*${key}[ \\t]*=([^\r\n]*)`, 'm');
  const match = re.exec(text);
  if (!match) return '';
  let value = match[1].trim();
  if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
  else value = value.replace(/\s+#.*$/, '');
  return value.trim();
}

/** .env text with KEY set to value: replaces the first KEY= line, or appends one. */
function setEnvValue(text, key, value) {
  const re = new RegExp(`^([ \\t]*)${key}[ \\t]*=[^\r\n]*`, 'm');
  const line = `${key}=${value}`;
  if (re.test(text)) return text.replace(re, (_m, indent) => `${indent}${line}`);
  const sep = text === '' || text.endsWith('\n') ? '' : '\n';
  return `${text}${sep}${line}\n`;
}

/** Discord bot tokens are three dot-separated base64url parts; catches pasting the wrong thing. */
function looksLikeToken(value) {
  return /^[\w-]{20,}\.[\w-]{4,}\.[\w-]{20,}$/.test(value.trim());
}

module.exports = { MIN_NODE, nodeVersionOk, readEnvValue, setEnvValue, looksLikeToken };
