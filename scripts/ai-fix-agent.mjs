#!/usr/bin/env node
/**
 * AI Fix Agent
 *
 * Iterative debugging agent for failing Cypress tests.
 *
 * Pipeline per failing test:
 *   1. Gather enriched context (spec + page objects + app component under test)
 *   2. Ask LLM to classify root cause: test-bug | app-bug | flaky
 *   3. Only apply fixes for test-bug / flaky (surgical {oldString,newString} patches)
 *   4. Re-run THAT spec only; if still failing, feed new error back (max N iterations)
 *   5. If passes → keep fix. If exhausted → revert file & mark unfixable.
 *
 * After all tests processed:
 *   - Create a NEW branch `ai-fix/<base>-<timestamp>` from current HEAD
 *   - Commit fixes & push that branch
 *
 * Flags:
 *   --dry-run      Apply patches but don't run cypress, don't push.
 *   --skip-verify  Apply patches without re-running cypress (still pushes).
 *
 * Env:
 *   OPENAI_API_KEY (required)
 *   AI_MODEL                (default: gpt-5.4-mini)
 *   AI_MAX_ITERATIONS       (default: 3)
 */

import {
  readFileSync,
  writeFileSync,
  existsSync,
  readdirSync,
  statSync,
  unlinkSync,
} from 'fs'
import { join, dirname, basename, relative } from 'path'
import { fileURLToPath } from 'url'
import { execSync, spawnSync } from 'child_process'
import OpenAI from 'openai'

//  Setup 

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const ROOT = join(__dirname, '..')

// Manual .env.local load (so it works without `node --env-file`)
const envPath = join(ROOT, '.env.local')
if (existsSync(envPath)) {
  for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const i = t.indexOf('=')
    if (i === -1) continue
    const k = t.slice(0, i).trim()
    const v = t.slice(i + 1).trim()
    if (!(k in process.env)) process.env[k] = v
  }
}

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const AI_MODEL = process.env.AI_MODEL || 'gpt-4o'
const MAX_ITERATIONS = Number(process.env.AI_MAX_ITERATIONS || 3)
const DRY_RUN = process.argv.includes('--dry-run')
const SKIP_VERIFY = process.argv.includes('--skip-verify')

if (!OPENAI_API_KEY) {
  console.error('ERROR: OPENAI_API_KEY is not set')
  process.exit(1)
}

const openai = new OpenAI({ apiKey: OPENAI_API_KEY })

//  Logging 

const logLines = []
function log(...args) {
  const line = args
    .map((a) => (typeof a === 'string' ? a : JSON.stringify(a, null, 2)))
    .join(' ')
  console.log(line)
  logLines.push(line)
}

function flushLog() {
  const dir = join(ROOT, 'cypress', 'results')
  if (existsSync(dir)) {
    writeFileSync(join(dir, 'ai-agent.log'), logLines.join('\n'))
  }
}

//  Test results parsing (Cypress after:run + mochawesome) 

function readMergedResults() {
  const resultsDir = join(ROOT, 'cypress', 'results')
  const merged = join(resultsDir, 'merged.json')
  if (existsSync(merged)) return JSON.parse(readFileSync(merged, 'utf-8'))

  if (!existsSync(resultsDir)) return null
  const top = readdirSync(resultsDir).filter((f) => f.endsWith('.json'))
  if (top.length) {
    return JSON.parse(readFileSync(join(resultsDir, top[0]), 'utf-8'))
  }

  const jsonsDir = join(resultsDir, '.jsons')
  if (existsSync(jsonsDir)) {
    const files = readdirSync(jsonsDir).filter((f) => f.endsWith('.json'))
    if (files.length) {
      const out = { results: [] }
      for (const f of files) {
        const d = JSON.parse(readFileSync(join(jsonsDir, f), 'utf-8'))
        out.results.push(...(d.results ?? [d]))
      }
      return out
    }
  }
  return null
}

function extractFailingTests(results) {
  const failing = []
  if (!results) return failing

  // Cypress after:run shape
  if (Array.isArray(results.runs)) {
    for (const run of results.runs) {
      const specFile = run.spec?.relative ?? run.spec?.name ?? ''
      for (const test of run.tests ?? []) {
        if (test.state !== 'failed') continue
        const attempt = test.attempts?.find((a) => a.state === 'failed') ?? {}
        failing.push({
          title: Array.isArray(test.title) ? test.title.join(' > ') : test.title,
          error: attempt.error?.message ?? test.displayError ?? 'Unknown error',
          stack: attempt.error?.stack ?? '',
          codeFrame: attempt.error?.codeFrame?.frame ?? '',
          specFile,
        })
      }
    }
    return failing
  }

  // Mochawesome shape
  function walk(suites, inheritedFile) {
    for (const suite of suites ?? []) {
      const specFile = suite.file ?? suite.fullFile ?? inheritedFile ?? ''
      for (const t of suite.tests ?? []) {
        if (t.state === 'failed' || t.pass === false) {
          failing.push({
            title: t.fullTitle ?? t.title,
            error: t.err?.message ?? 'Unknown error',
            stack: t.err?.estack ?? '',
            codeFrame: '',
            specFile,
          })
        }
      }
      walk(suite.suites, specFile)
    }
  }
  for (const r of results.results ?? []) walk(r.suites, r.file ?? r.fullFile ?? '')
  return failing
}

//  Context gathering 

function resolveSpecPath(specFile) {
  if (!specFile) return null
  const candidate = join(ROOT, specFile.replace(/^\//, ''))
  if (existsSync(candidate)) return candidate
  const e2eDir = join(ROOT, 'cypress', 'e2e')
  if (!existsSync(e2eDir)) return null
  const match = readdirSync(e2eDir).find((f) => specFile.includes(basename(f)))
  return match ? join(e2eDir, match) : null
}

/** Resolve `import X from '<rel>'` paths, scoped to cypress/. */
function findPageObjects(specPath, specSrc) {
  const dir = dirname(specPath)
  const out = []
  const re = /import\s+\w+\s+from\s+['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(specSrc))) {
    const rel = m[1]
    if (!rel.startsWith('.')) continue
    for (const ext of ['', '.js', '.ts', '.jsx', '.tsx']) {
      const p = join(dir, rel + ext)
      if (existsSync(p) && statSync(p).isFile()) {
        out.push({ path: p, src: readFileSync(p, 'utf-8') })
        break
      }
    }
  }
  return out
}

/** Map cy.visit() routes to Next.js app router files (read-only context). */
function findAppFiles(specSrc, pageObjects) {
  const allSrc = specSrc + '\n' + pageObjects.map((p) => p.src).join('\n')
  const routes = new Set()
  const re = /cy\.visit\(\s*['"]([^'"]+)['"]/g
  let m
  while ((m = re.exec(allSrc))) routes.add(m[1])

  const appDir = join(ROOT, 'src', 'app')
  const out = []
  for (const route of routes) {
    const segments = route.replace(/^\/+/, '').split('/').filter(Boolean)
    const candidates = [
      join(appDir, ...segments, 'page.tsx'),
      join(appDir, ...segments, 'page.ts'),
      // Common route group in this repo
      join(appDir, '(auth)', ...segments, 'page.tsx'),
    ]
    for (const c of candidates) {
      if (existsSync(c)) {
        out.push({ path: c, src: readFileSync(c, 'utf-8'), route })
        break
      }
    }
    if (segments[0] === 'api') {
      const apiRoute = join(appDir, ...segments, 'route.ts')
      if (existsSync(apiRoute)) {
        out.push({ path: apiRoute, src: readFileSync(apiRoute, 'utf-8'), route })
      }
    }
  }
  return out
}

function buildTestContext(test) {
  const specPath = resolveSpecPath(test.specFile)
  if (!specPath) return null
  const specSrc = readFileSync(specPath, 'utf-8')
  const pageObjects = findPageObjects(specPath, specSrc)
  const appFiles = findAppFiles(specSrc, pageObjects)
  return { specPath, specSrc, pageObjects, appFiles }
}

//  LLM 

const SYSTEM_PROMPT = `You are an expert Cypress E2E debugging agent.

You receive: a failing test, its error/stack, the spec source, related Page Objects,
and the application source (Next.js app router) the test exercises.

Classify the failure root cause as ONE of:
  - "test-bug"  → the test itself is wrong (stale selector, wrong assertion text,
                  wrong URL, missing wait). Safe to fix the test.
  - "app-bug"   → the application has a real bug (UI does not render, API returns
                  wrong status, business logic broken). DO NOT modify the test.
  - "flaky"     → race condition / timing. Fix by adding cy.wait, cy.intercept
                  with .as()+cy.wait('@alias'), or increasing timeout for that
                  specific assertion. Modify the TEST only.

Rules:
- Prefer surgical patches over rewrites. Each patch is {file, oldString, newString}
  where oldString MUST appear EXACTLY ONCE in the named file.
- oldString must include enough surrounding context (3+ lines) to be unique.
- NEVER patch files outside cypress/ — only files under cypress/.
- If category is "app-bug", set patches=[] and explain the bug clearly in "diagnosis".
- Keep patches minimal: one selector / assertion / wait at a time.

Respond with RAW JSON only (no markdown, no code fences):
{
  "category": "test-bug" | "app-bug" | "flaky",
  "confidence": 0.0,
  "reason": "one short sentence",
  "diagnosis": "longer explanation of root cause and why the fix works (or why a human is needed)",
  "patches": [
    { "file": "<absolute path from input>", "oldString": "...", "newString": "..." }
  ]
}`

function buildUserMessage(test, ctx, history) {
  const sections = [
    `## Failing test\n${test.title}`,
    `## Error\n${test.error}`,
  ]
  if (test.stack) sections.push(`## Stack\n${test.stack.slice(0, 1500)}`)
  if (test.codeFrame) sections.push(`## Code frame\n${test.codeFrame}`)

  sections.push(`## Spec file\nPATH: ${ctx.specPath}\n\`\`\`js\n${ctx.specSrc}\n\`\`\``)

  for (const po of ctx.pageObjects) {
    sections.push(`## Page Object\nPATH: ${po.path}\n\`\`\`js\n${po.src}\n\`\`\``)
  }
  for (const af of ctx.appFiles) {
    sections.push(
      `## App source under test (route ${af.route})\nPATH: ${af.path}\n\`\`\`tsx\n${af.src}\n\`\`\``,
    )
  }
  if (history.length) {
    sections.push(
      `## Previous failed attempts in this session\n${history
        .map((h, i) => `Attempt ${i + 1}: ${h.reason}\nResulting error: ${h.newError}`)
        .join('\n\n')}`,
    )
  }
  return sections.join('\n\n')
}

async function askLLM(test, ctx, history) {
  // Newer models (gpt-5.x, o-series) require max_completion_tokens and don't
  // accept temperature. Older models (gpt-4o, gpt-4-turbo) use max_tokens.
  const isNewModel = /^(gpt-5|o[1-9])/i.test(AI_MODEL)
  const params = {
    model: AI_MODEL,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: buildUserMessage(test, ctx, history) },
    ],
    response_format: { type: 'json_object' },
  }
  if (isNewModel) {
    params.max_completion_tokens = 4096
  } else {
    params.max_tokens = 4096
    params.temperature = 0.1
  }
  const res = await openai.chat.completions.create(params)
  const content = res.choices[0].message.content?.trim() ?? '{}'
  try {
    return JSON.parse(content)
  } catch {
    const m = content.match(/\{[\s\S]*\}/)
    if (m) {
      try {
        return JSON.parse(m[0])
      } catch {
        /* */
      }
    }
    return {
      category: 'app-bug',
      confidence: 0,
      reason: 'unparseable AI response',
      diagnosis: content.slice(0, 300),
      patches: [],
    }
  }
}

//  Surgical patching 

function applyPatches(patches) {
  const snapshots = new Map()
  const touched = new Set()

  for (const p of patches) {
    if (!p.file || !p.oldString || p.newString === undefined) {
      throw new Error('Invalid patch shape')
    }
    const abs = p.file.startsWith('/') ? p.file : join(ROOT, p.file)
    const rel = relative(ROOT, abs)
    if (!rel.startsWith('cypress/')) {
      throw new Error(`Refusing to patch outside cypress/: ${rel}`)
    }
    if (!existsSync(abs)) throw new Error(`Patch target missing: ${rel}`)
    if (!snapshots.has(abs)) snapshots.set(abs, readFileSync(abs, 'utf-8'))

    const current = readFileSync(abs, 'utf-8')
    const occurrences = current.split(p.oldString).length - 1
    if (occurrences === 0) throw new Error(`oldString not found in ${rel}`)
    if (occurrences > 1) throw new Error(`oldString not unique in ${rel} (${occurrences} matches)`)

    writeFileSync(abs, current.replace(p.oldString, p.newString))
    touched.add(abs)
  }

  // Validate JS syntax for every patched .js file
  for (const abs of touched) {
    if (!abs.endsWith('.js')) continue
    const r = spawnSync('node', ['--check', abs], { encoding: 'utf-8' })
    if (r.status !== 0) {
      for (const [f, src] of snapshots) writeFileSync(f, src)
      throw new Error(`Syntax error after patch in ${relative(ROOT, abs)}: ${r.stderr.trim()}`)
    }
  }

  return { snapshots, touched: [...touched] }
}

function revert(snapshots) {
  for (const [file, src] of snapshots) writeFileSync(file, src)
}

//  Re-run a single spec 

function runSingleSpec(specPath) {
  const rel = relative(ROOT, specPath)
  log(`  ↻ Re-running spec: ${rel}`)
  const r = spawnSync(
    'npx',
    ['cypress', 'run', '--spec', rel, '--reporter', 'cypress-mochawesome-reporter'],
    { cwd: ROOT, encoding: 'utf-8', stdio: ['ignore', 'pipe', 'pipe'] },
  )
  log(`  exit=${r.status}`)
  const results = readMergedResults()
  const failing = extractFailingTests(results).filter(
    (t) => resolveSpecPath(t.specFile) === specPath,
  )
  return { passed: r.status === 0, failing }
}

// Iterative fix loop 

async function debugTest(test) {
  log(`\n▶ "${test.title}"`)
  log(`  error: ${test.error}`)

  const ctx = buildTestContext(test)
  if (!ctx) {
    return { status: 'unfixable', test, reason: `Spec not found: ${test.specFile}` }
  }
  log(
    `  context: spec=${relative(ROOT, ctx.specPath)} pageObjects=${ctx.pageObjects.length} appFiles=${ctx.appFiles.length}`,
  )

  const history = []
  let currentTest = test
  let currentCtx = ctx
  let lastDiagnosis = null

  for (let iter = 1; iter <= MAX_ITERATIONS; iter++) {
    log(`  ─ iteration ${iter}/${MAX_ITERATIONS}`)
    const ai = await askLLM(currentTest, currentCtx, history)
    lastDiagnosis = ai
    log(`    category=${ai.category} confidence=${ai.confidence ?? '?'} reason=${ai.reason}`)

    if (ai.category === 'app-bug') {
      return { status: 'app-bug', test, reason: ai.reason, diagnosis: ai.diagnosis }
    }
    if (!ai.patches || ai.patches.length === 0) {
      return {
        status: 'unfixable',
        test,
        reason: ai.reason || 'No patches proposed',
        diagnosis: ai.diagnosis,
      }
    }

    let snapshots
    try {
      ;({ snapshots } = applyPatches(ai.patches))
    } catch (e) {
      log(`    patch error: ${e.message}`)
      history.push({ reason: ai.reason, newError: `Patch failed: ${e.message}` })
      continue
    }

    if (DRY_RUN || SKIP_VERIFY) {
      log(`    ${DRY_RUN ? '(dry-run)' : '(skip-verify)'} skipping cypress re-run`)
      return {
        status: 'fixed',
        test,
        category: ai.category,
        reason: ai.reason,
        diagnosis: ai.diagnosis,
        files: [...snapshots.keys()].map((f) => relative(ROOT, f)),
        verified: false,
        iterations: iter,
      }
    }

    const { passed, failing } = runSingleSpec(currentCtx.specPath)
    const stillFailingThis = failing.find((f) => f.title === test.title)
    if (passed && !stillFailingThis) {
      log(`    ✓ test now passes`)
      return {
        status: 'fixed',
        test,
        category: ai.category,
        reason: ai.reason,
        diagnosis: ai.diagnosis,
        files: [...snapshots.keys()].map((f) => relative(ROOT, f)),
        verified: true,
        iterations: iter,
      }
    }

    const next = stillFailingThis || failing[0]
    log(`    ✗ still failing: ${next?.error?.slice(0, 120)}`)
    history.push({ reason: ai.reason, newError: next?.error || 'unknown' })

    // Revert before next iteration so each attempt starts clean
    revert(snapshots)
    currentTest = next || currentTest
    currentCtx = buildTestContext(currentTest) || currentCtx
  }

  return {
    status: 'unfixable',
    test,
    reason: `Exhausted ${MAX_ITERATIONS} iterations`,
    diagnosis: lastDiagnosis?.diagnosis,
  }
}

// Git 

function git(args) {
  return execSync(`git ${args}`, { cwd: ROOT, encoding: 'utf-8' }).trim()
}

function pushToNewBranch(fixes) {
  let baseBranch = 'main'
  try {
    baseBranch = git('rev-parse --abbrev-ref HEAD')
  } catch {
    /* */
  }
  const ts = new Date()
    .toISOString()
    .replace(/[:.]/g, '-')
    .replace('T', '_')
    .slice(0, 19)
  const branch = `ai-fix/${baseBranch.replace(/[^a-zA-Z0-9_-]/g, '-')}-${ts}`

  try {
    git('config user.name "ai-fix-agent[bot]"')
    git('config user.email "ai-fix-agent@users.noreply.github.com"')
  } catch {
    /* fine if already configured */
  }
  git(`checkout -b ${branch}`)
  git('add cypress/')

  const summary = fixes.map((f) => `  - [${f.category}] ${f.test.title}`).join('\n')
  const msg = `fix(tests): AI auto-fix for failing Cypress tests\n\n${summary}\n\nCo-authored-by: ai-fix-agent[bot]\n`
  const tmp = join(ROOT, '.ai-commit-msg.tmp')
  writeFileSync(tmp, msg)
  try {
    git(`commit -F ${tmp}`)
  } finally {
    try {
      unlinkSync(tmp)
    } catch {
      /* */
    }
  }

  // Push only if a remote exists
  let pushed = false
  try {
    const remotes = git('remote')
    if (remotes.includes('origin')) {
      git(`push -u origin ${branch}`)
      pushed = true
    }
  } catch (e) {
    log(`  push failed: ${e.message}`)
  }
  log(`✓ Branch created: ${branch} ${pushed ? '(pushed)' : '(local only — no origin/push failed)'}`)
  return { branch, baseBranch, pushed }
}

// Main

async function main() {
  log('=== AI Fix Agent ===')
  log(
    `model=${AI_MODEL} maxIter=${MAX_ITERATIONS} dryRun=${DRY_RUN} skipVerify=${SKIP_VERIFY}`,
  )

  const results = readMergedResults()
  if (!results) {
    log('No results found, nothing to do.')
    flushLog()
    process.exit(0)
  }

  const failing = extractFailingTests(results)
  log(`Failing tests: ${failing.length}`)
  if (!failing.length) {
    flushLog()
    process.exit(0)
  }

  const fixes = []
  const appBugs = []
  const unfixable = []

  for (const test of failing) {
    const r = await debugTest(test)
    if (r.status === 'fixed') fixes.push(r)
    else if (r.status === 'app-bug') appBugs.push(r)
    else unfixable.push(r)
  }

  log(`\nSummary: fixed=${fixes.length} appBugs=${appBugs.length} unfixable=${unfixable.length}`)

  if (fixes.length && !DRY_RUN) {
    try {
      pushToNewBranch(fixes)
    } catch (e) {
      log(`Branch/push failed: ${e.message}`)
    }
  }

  flushLog()
  process.exit(unfixable.length || appBugs.length ? 1 : 0)
}

main().catch((err) => {
  log(`CRASH: ${err.stack || err.message}`)
  flushLog()
  process.exit(1)
})
