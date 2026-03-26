import { parseVersion, versionLt, isCheckEnabled, DEFAULT_SETTINGS, ExtensionSettings } from '../server/src/providers/settings';
import { parseBisonDocument } from '../server/src/parser/bisonParser';
import { parseFlexDocument } from '../server/src/parser/flexParser';
import { computeBisonDiagnostics, computeFlexDiagnostics } from '../server/src/providers/diagnostics';

let passed = 0;
let failed = 0;
function check(desc: string, got: unknown, expected: unknown) {
  const ok = JSON.stringify(got) === JSON.stringify(expected);
  if (ok) { passed++; console.log(`  [PASS] ${desc}`); }
  else     { failed++; console.error(`  [FAIL] ${desc} — got ${JSON.stringify(got)}, expected ${JSON.stringify(expected)}`); }
}

// parseVersion
console.log('\n=== parseVersion ===');
check('2.3',   parseVersion('2.3'),   [2, 3, 0]);
check('3.0',   parseVersion('3.0'),   [3, 0, 0]);
check('3.2.1', parseVersion('3.2.1'), [3, 2, 1]);
check('empty', parseVersion(''),      [0, 0, 0]);
check('bad',   parseVersion('foo'),   [0, 0, 0]);

// versionLt
console.log('\n=== versionLt ===');
check('2.3 < 3.0',  versionLt('2.3', '3.0'),  true);
check('3.0 < 3.0',  versionLt('3.0', '3.0'),  false);
check('3.1 < 3.0',  versionLt('3.1', '3.0'),  false);
check('2.9 < 3.0',  versionLt('2.9', '3.0'),  true);
check('3.2 < 3.2',  versionLt('3.2', '3.2'),  false);
check('3.1 < 3.2',  versionLt('3.1', '3.2'),  true);

// isCheckEnabled — default settings (everything enabled)
console.log('\n=== isCheckEnabled (defaults) ===');
check('missing-empty default', isCheckEnabled('bison/missing-empty', DEFAULT_SETTINGS), true);
check('yacc-compat default',   isCheckEnabled('bison/yacc-compat',   DEFAULT_SETTINGS), true);
check('unknown code default',  isCheckEnabled('bison/unknown-stuff',  DEFAULT_SETTINGS), true);

// isCheckEnabled — disabledChecks
console.log('\n=== isCheckEnabled (disabledChecks) ===');
const settingsDisabled: ExtensionSettings = { ...DEFAULT_SETTINGS, disabledChecks: ['bison/missing-empty', 'flex/missing-yywrap'] };
check('explicitly disabled',    isCheckEnabled('bison/missing-empty',  settingsDisabled), false);
check('flex explicitly disabled', isCheckEnabled('flex/missing-yywrap', settingsDisabled), false);
check('not disabled',           isCheckEnabled('bison/yacc-compat',    settingsDisabled), true);

// isCheckEnabled — minVersionBison suppression
console.log('\n=== isCheckEnabled (minVersionBison) ===');
const settingsV23: ExtensionSettings = { ...DEFAULT_SETTINGS, minVersionBison: '2.3' };
check('missing-empty suppressed at 2.3', isCheckEnabled('bison/missing-empty', settingsV23), false);
check('yacc-compat suppressed at 2.3',   isCheckEnabled('bison/yacc-compat',   settingsV23), false);
check('undeclared-token not suppressed', isCheckEnabled('bison/undeclared-token', settingsV23), true);
check('shift-reduce not suppressed',     isCheckEnabled('bison/shift-reduce',   settingsV23), true);

const settingsV30: ExtensionSettings = { ...DEFAULT_SETTINGS, minVersionBison: '3.0' };
check('missing-empty at exactly 3.0',   isCheckEnabled('bison/missing-empty', settingsV30), true);
check('yacc-compat at exactly 3.0',     isCheckEnabled('bison/yacc-compat',   settingsV30), true);

// isCheckEnabled — disabledChecks takes priority over version
console.log('\n=== isCheckEnabled (both) ===');
const settingsBoth: ExtensionSettings = { minVersionBison: '3.5', minVersionFlex: '', disabledChecks: ['bison/shift-reduce'] };
check('disabled overrides version', isCheckEnabled('bison/shift-reduce', settingsBoth), false);
check('version does not suppress 3.0 check at 3.5', isCheckEnabled('bison/missing-empty', settingsBoth), true);

// ── Integration: computeBisonDiagnostics with settings ───────────────────────

console.log('\n=== computeBisonDiagnostics: minVersionBison suppression ===');
{
  const src = '%token A\n%%\nexpr : A\n     |\n     ;\n%%\n';
  const doc = parseBisonDocument(src);
  const diagsDefault = computeBisonDiagnostics(doc, src);
  const diagsV23     = computeBisonDiagnostics(doc, src, { ...DEFAULT_SETTINGS, minVersionBison: '2.3' });
  const diagsV30     = computeBisonDiagnostics(doc, src, { ...DEFAULT_SETTINGS, minVersionBison: '3.0' });

  check('missing-empty present with default settings',
    diagsDefault.some(d => d.code === 'bison/missing-empty'), true);
  check('missing-empty suppressed at minVersionBison=2.3',
    diagsV23.some(d => d.code === 'bison/missing-empty'), false);
  check('missing-empty present at minVersionBison=3.0',
    diagsV30.some(d => d.code === 'bison/missing-empty'), true);
}

console.log('\n=== computeBisonDiagnostics: yacc-compat suppression ===');
{
  const src = '%error-verbose\n%token A\n%%\nexpr : A ;\n%%\n';
  const doc = parseBisonDocument(src);
  const diagsDefault = computeBisonDiagnostics(doc, src);
  const diagsV23     = computeBisonDiagnostics(doc, src, { ...DEFAULT_SETTINGS, minVersionBison: '2.3' });

  check('yacc-compat present by default',
    diagsDefault.some(d => d.code === 'bison/yacc-compat'), true);
  check('yacc-compat suppressed at 2.3',
    diagsV23.some(d => d.code === 'bison/yacc-compat'), false);
}

console.log('\n=== computeBisonDiagnostics: disabledChecks ===');
{
  const src = '%token A B\n%%\nexpr : A ;\n%%\n';
  const doc = parseBisonDocument(src);
  const diagsDefault  = computeBisonDiagnostics(doc, src);
  const diagsDisabled = computeBisonDiagnostics(doc, src, { ...DEFAULT_SETTINGS, disabledChecks: ['bison/unused-token'] });

  check('unused-token present by default',
    diagsDefault.some(d => d.code === 'bison/unused-token'), true);
  check('unused-token suppressed by disabledChecks',
    diagsDisabled.some(d => d.code === 'bison/unused-token'), false);
}

console.log('\n=== computeBisonDiagnostics: feature-requires-version ===');
{
  const src = '%define api.value.type variant\n%token A\n%%\nexpr : A ;\n%%\n';
  const doc = parseBisonDocument(src);
  const diagsNoMin = computeBisonDiagnostics(doc, src);
  const diagsV23   = computeBisonDiagnostics(doc, src, { ...DEFAULT_SETTINGS, minVersionBison: '2.3' });
  const diagsV32   = computeBisonDiagnostics(doc, src, { ...DEFAULT_SETTINGS, minVersionBison: '3.2' });

  check('no feature-requires-version without minVersionBison',
    diagsNoMin.some(d => d.code === 'bison/feature-requires-version'), false);
  check('feature-requires-version emitted at 2.3 (needs 3.2)',
    diagsV23.some(d => d.code === 'bison/feature-requires-version'), true);
  check('no feature-requires-version at 3.2 (exactly meets requirement)',
    diagsV32.some(d => d.code === 'bison/feature-requires-version'), false);
}

console.log('\n=== computeFlexDiagnostics: disabledChecks ===');
{
  const src = '%%\n[a-z]+\t{ }\n%%\n';
  const flexMod = require('../server/src/parser/flexParser');
  const doc = flexMod.parseFlexDocument(src);
  const diagsDefault  = computeFlexDiagnostics(doc, src);
  const diagsDisabled = computeFlexDiagnostics(doc, src, { ...DEFAULT_SETTINGS, disabledChecks: ['flex/missing-yywrap'] });

  check('missing-yywrap present by default',
    diagsDefault.some((d: any) => d.code === 'flex/missing-yywrap'), true);
  check('missing-yywrap suppressed by disabledChecks',
    diagsDisabled.some((d: any) => d.code === 'flex/missing-yywrap'), false);
}

console.log(`\n${'='.repeat(50)}`);
console.log(`  RESULTS: ${passed} passed, ${failed} failed`);
if (failed > 0) process.exit(1);
