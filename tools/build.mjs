// Builds the extension's rulesets and cosmetic/scriptlet data from filter lists.
//   node tools/build.mjs            download lists, then convert
//   node tools/build.mjs --offline  convert the copies already in tools/cache
import { mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { downloadAll, cacheFileFor } from './download.mjs';
import { expandList } from './lib/preprocess.mjs';
import { parseNetworkFilter, filterToRule, mergeHostRules, ruleKind } from './lib/network.mjs';
import { CosmeticCollector } from './lib/cosmetic.mjs';
import { writeScriptletShards } from './lib/scriptlet-shards.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
// Chrome guarantees 30,000 enabled static rules per extension; staying under
// it means the rulesets never depend on the shared global pool.
const STATIC_RULE_BUDGET = 30_000;
const REGEX_RULE_BUDGET = 1_000;
const EXTENDED_SYNTAX = /#\$\?#|#@\$\?#|\$\$|\$@\$|#@?%#/;

function normalizeBadfilter(line) {
  const i = line.lastIndexOf('$');
  if (i < 0) return line;
  const opts = line.slice(i + 1).split(',').filter(o => o !== 'badfilter');
  return opts.length ? `${line.slice(0, i)}$${opts.sort().join(',')}` : line.slice(0, i);
}

function sortedOptions(line) {
  const i = line.lastIndexOf('$');
  if (i < 0) return line;
  return `${line.slice(0, i)}$${line.slice(i + 1).split(',').sort().join(',')}`;
}

async function readRulesetLines(config) {
  const byRuleset = {};
  for (const [key, def] of Object.entries(config.rulesets)) {
    const seen = new Set();
    const lines = [];
    for (const url of def.lists) lines.push(...await expandList(url, cacheFileFor, seen));
    byRuleset[key] = lines;
  }
  return byRuleset;
}

function convertRuleset(lines, badfilters, cosmetic, regexBudget) {
  const rules = [];
  // Regex rules ship separately and become dynamic rules once Chrome has
  // confirmed it can compile them; one bad regex in a static ruleset would
  // stop the whole extension from loading.
  const regexRules = [];
  const skipped = {};
  const skip = reason => { skipped[reason] = (skipped[reason] || 0) + 1; };
  const seenFilters = new Set();
  for (const line of lines) {
    if (EXTENDED_SYNTAX.test(line)) { skip('extended-syntax'); continue; }
    if (cosmetic.add(line)) continue;
    if (seenFilters.has(line)) continue;
    seenFilters.add(line);
    if (badfilters.has(sortedOptions(line))) { skip('badfilter'); continue; }
    const f = parseNetworkFilter(line);
    if (f.skip) { skip(f.skip); continue; }
    if (f.badfilter) continue;
    if (f.cosmetic) {
      if (f.exception) cosmetic.addDisabled(f.cosmetic, f.pattern);
      continue;
    }
    const r = filterToRule(f);
    if (r.skip) { skip(r.skip); continue; }
    if (r.rule.condition.regexFilter) {
      if (regexBudget.left <= 0) { skip('regex-budget'); continue; }
      regexBudget.left--;
      regexRules.push(r.rule);
      continue;
    }
    rules.push(r.rule);
  }
  return { rules: mergeHostRules(rules), regexRules, skipped };
}

/** Orders rules block -> modify -> allow and numbers them, so the counter can tell them apart by id. */
function assignIds(rules) {
  const order = { block: 0, modify: 1, allow: 2 };
  const sorted = [...rules].sort((a, b) => order[ruleKind(a)] - order[ruleKind(b)]);
  let lastBlockId = 0;
  const withIds = sorted.map((rule, i) => {
    if (ruleKind(rule) === 'block') lastBlockId = i + 1;
    return { id: i + 1, ...rule };
  });
  return { rules: withIds, lastBlockId };
}

async function main() {
  const offline = process.argv.includes('--offline');
  console.log(offline ? 'Using cached lists (offline).' : 'Downloading filter lists...');
  const { config, report } = await downloadAll({ offline });
  const problems = report.filter(r => !/^(downloaded|cached)$/.test(r.status));
  for (const p of problems) console.warn(`  ! ${p.url}: ${p.status}`);

  const byRuleset = await readRulesetLines(config);
  const badfilters = new Set();
  for (const lines of Object.values(byRuleset)) {
    for (const line of lines) if (/\$(.*,)?badfilter(,|$)/.test(line)) badfilters.add(normalizeBadfilter(line));
  }

  const cosmetic = new CosmeticCollector();
  const regexBudget = { left: REGEX_RULE_BUDGET };
  await rm(join(ROOT, 'rulesets'), { recursive: true, force: true });
  await mkdir(join(ROOT, 'rulesets'), { recursive: true });
  const meta = { builtAt: new Date().toISOString(), rulesets: {} };
  let enabledTotal = 0;
  const allRegexRules = [];
  for (const [key, def] of Object.entries(config.rulesets)) {
    const { rules: converted, regexRules, skipped } = convertRuleset(byRuleset[key], badfilters, cosmetic, regexBudget);
    if (def.enabled) allRegexRules.push(...regexRules);
    let { rules, lastBlockId } = assignIds(converted);
    if (def.enabled && enabledTotal + rules.length > STATIC_RULE_BUDGET) {
      const keep = STATIC_RULE_BUDGET - enabledTotal;
      console.warn(`  ! ${key}: ${rules.length} rules exceeds the budget; keeping the first ${keep}`);
      rules = rules.slice(0, keep);
      lastBlockId = Math.min(lastBlockId, keep);
    }
    if (def.enabled) enabledTotal += rules.length;
    await writeFile(join(ROOT, 'rulesets', `${key}.json`), JSON.stringify(rules));
    meta.rulesets[key] = { title: def.title, enabled: def.enabled, rules: rules.length, lastBlockId, skipped };
    console.log(`  ${key.padEnd(8)} ${String(byRuleset[key].length).padStart(7)} lines -> ${String(rules.length).padStart(6)} rules`);
  }

  const { cosmetic: tables, scriptlets, scriptletExceptions, stats } = cosmetic.finish();
  await mkdir(join(ROOT, 'data'), { recursive: true });
  await writeFile(join(ROOT, 'data', 'cosmetic.json'), JSON.stringify(tables));
  const shardInfo = await writeScriptletShards(ROOT, scriptlets, scriptletExceptions);
  meta.cosmetic = stats;
  meta.scriptlets = shardInfo.summary;
  const { rules: regexRules, lastBlockId: regexLastBlock } = assignIds(allRegexRules);
  // ids are rewritten at runtime; keep only the block-first order and the boundary.
  await writeFile(join(ROOT, 'data', 'regex-rules.json'), JSON.stringify(regexRules.map(({ id, ...rule }) => rule)));
  meta.regex = { rules: regexRules.length, lastBlockIndex: regexLastBlock };
  meta.regexRulesUsed = REGEX_RULE_BUDGET - regexBudget.left;
  meta.enabledStaticRules = enabledTotal;
  await writeFile(join(ROOT, 'data', 'meta.json'), JSON.stringify(meta, null, 2));
  await updateManifest(config);

  console.log(`  enabled static rules: ${enabledTotal} / ${STATIC_RULE_BUDGET}, regex rules: ${meta.regexRulesUsed}`);
  console.log(`  cosmetic: ${stats.genericKeyed} keyed generic, ${stats.genericMisc} always-on generic, ${stats.specificHosts} hosts`);
  console.log(`  scriptlets: ${shardInfo.summary.hosts} hosts in ${shardInfo.summary.shards} shards`);
}

/** Keeps manifest.json's rule_resources in step with lists.json. */
async function updateManifest(config) {
  const path = join(ROOT, 'manifest.json');
  const manifest = JSON.parse(await readFile(path, 'utf8'));
  manifest.declarative_net_request = {
    rule_resources: Object.entries(config.rulesets).map(([id, def]) => ({
      id, enabled: def.enabled, path: `rulesets/${id}.json`,
    })),
  };
  await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
