/**
 * Extension settings interface and version-check utilities.
 *
 * isCheckEnabled() is the single gate every diagnostic provider uses
 * to decide whether to emit a diagnostic.
 */

export interface ExtensionSettings {
  minVersionBison: string;   // e.g. "2.3" — empty string means "not configured"
  minVersionFlex:  string;   // e.g. "" (empty = not configured)
  disabledChecks:  string[]; // e.g. ["bison/shift-reduce", "flex/missing-yywrap"]
}

export const DEFAULT_SETTINGS: ExtensionSettings = {
  minVersionBison: '',
  minVersionFlex:  '',
  disabledChecks:  [],
};

/**
 * Map of diagnostic code → the minimum Bison version at which it becomes
 * relevant. If the user's minVersionBison is BELOW this value the check is
 * automatically suppressed (they can't/shouldn't use that feature yet).
 */
const BISON_CODE_MIN_VERSION: Record<string, string> = {
  'bison/missing-empty': '3.0',  // %empty directive introduced in Bison 3.0
  'bison/yacc-compat':   '3.0',  // Yacc→Bison migration hints only relevant for Bison 3.x users
};

/**
 * Map of diagnostic code → the minimum Flex version at which it becomes
 * relevant. Currently empty — placeholder for future entries.
 */
const FLEX_CODE_MIN_VERSION: Record<string, string> = {
  // e.g. 'flex/reentrant-option': '2.5.9'
};

/**
 * Parse a version string like "3.2" or "3.2.1" into a [major, minor, patch] tuple.
 * Returns [0, 0, 0] on empty input or unparseable strings.
 */
export function parseVersion(v: string): [number, number, number] {
  if (!v || !v.trim()) return [0, 0, 0];
  const parts = v.trim().split('.').map(Number);
  if (parts.some(isNaN)) return [0, 0, 0];
  const [major = 0, minor = 0, patch = 0] = parts;
  return [major, minor, patch];
}

/**
 * Returns true if version string `a` is strictly less than version string `b`.
 */
export function versionLt(a: string, b: string): boolean {
  const [aMaj, aMin, aPat] = parseVersion(a);
  const [bMaj, bMin, bPat] = parseVersion(b);
  if (aMaj !== bMaj) return aMaj < bMaj;
  if (aMin !== bMin) return aMin < bMin;
  return aPat < bPat;
}

/**
 * Returns true if the diagnostic with the given code should be emitted
 * given the current user settings.
 *
 * Rules (in order):
 * 1. If the code is in disabledChecks → false
 * 2. If minVersionBison is set and the code has a Bison version requirement
 *    AND the user's version is below that requirement → false
 * 3. If minVersionFlex is set and the code has a Flex version requirement
 *    AND the user's version is below that requirement → false
 * 4. Otherwise → true
 */
export function isCheckEnabled(code: string, settings: ExtensionSettings): boolean {
  if (settings.disabledChecks.includes(code)) return false;

  if (settings.minVersionBison) {
    const required = BISON_CODE_MIN_VERSION[code];
    if (required && versionLt(settings.minVersionBison, required)) return false;
  }

  if (settings.minVersionFlex) {
    const required = FLEX_CODE_MIN_VERSION[code];
    if (required && versionLt(settings.minVersionFlex, required)) return false;
  }

  return true;
}

/**
 * Features that, when present in a .y file, require a minimum Bison version.
 * Used by computeBisonDiagnostics to emit bison/feature-requires-version
 * when minVersionBison is set AND below the requirement.
 */
export const BISON_FEATURE_VERSIONS: Array<{
  pattern: RegExp;
  version: string;
  label: string;
}> = [
  { pattern: /api\.value\.type[\s=]+variant/,    version: '3.2', label: 'api.value.type=variant'  },
  { pattern: /api\.token\.constructor/,          version: '3.2', label: 'api.token.constructor'   },
  { pattern: /parse\.error\s+detailed/,          version: '3.6', label: 'parse.error detailed'    },
  { pattern: /glr2\.cc/,                         version: '3.7', label: 'glr2.cc skeleton'         },
];
