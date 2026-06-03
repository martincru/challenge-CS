# Challenge App

A full-stack web application built with [Next.js](https://nextjs.org) (App Router), TypeScript, and Tailwind CSS. It implements a complete authentication flow — registration, login, and protected access.

## Pages

| Route | Description |
|-------|-------------|
| `/login` | Sign-in form. Accepts email and password. On success, creates a session and redirects to the dashboard. Displays inline error messages for invalid credentials. |
| `/register` | Account creation form. Accepts name, email, and password. On success, creates a session and redirects to the dashboard. Validates required fields and rejects duplicate emails. |
| `/dashboard` | Protected page. Requires an active session — unauthenticated visits are redirected to `/login`. Displays a personalised welcome message, the signed-in email, account status, active sessions count, and user role. Contains a **Sign Out** button that destroys the session. |

The root path `/` redirects automatically to `/login`.

## Getting Started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Automated Tests

End-to-end tests are written with [Cypress](https://www.cypress.io/) following the **Page Object Model** pattern. Test files live in `cypress/e2e/` and their corresponding page objects in `cypress/pages/`.

### Test suites

| Suite | What it covers |
|-------|----------------|
| `login.cy.js` | Page structure (form fields, navigation links), happy path (valid credentials → redirect to `/dashboard`), negative cases (wrong password, unknown email) |
| `register.cy.js` | Page structure, happy path (new user → redirect to `/dashboard`), negative cases (duplicate email, empty form), server error handling (intercepted 500 response), navigation to login |
| `dashboard.cy.js` | Unauthenticated redirect to `/login`, authenticated access (welcome message, user info display, logout button visibility, sign-out flow) |

### Intentional bug

The login test suite contains a **deliberate failure** designed to exercise the AI Fix Agent. The `errorMessage` getter in `cypress/pages/LoginPage.js` uses a typo'd selector:

```js
// wrong — note the double 'e'
get errorMessage() { return cy.get('[data-testid="error-messagee"]') }
```

The correct `data-testid` in the app is `"error-message"`. Because of this mismatch, all negative-case tests in `login.cy.js` (wrong password, unknown email) will fail when run against the live app. This is intentional: the failure is the trigger for running the AI Fix Agent, which detects the root cause, patches the typo, and verifies the fix automatically.

### Running the tests

```bash
# Headless
npx cypress run

# With browser UI (slowed down for visibility)
npx cypress run --headed --config slowDown=2000

# Interactive mode
npx cypress open
```

## AI Fix Agent

`scripts/ai-fix-agent.mjs` is an autonomous debugging agent that fixes failing Cypress tests using an LLM.

### How it works

1. **Gather context** — reads the failing spec, its page objects, and the relevant app source file.
2. **Classify root cause** — asks the LLM to categorise the failure as `test-bug`, `app-bug`, or `flaky`.
3. **Apply fix** — for `test-bug` and `flaky` failures, the agent applies surgical `{oldString, newString}` patches to the affected file.
4. **Verify** — re-runs only the patched spec. If it still fails, the new error is fed back to the LLM and the cycle repeats (up to `AI_MAX_ITERATIONS` times).
5. **Commit & PR** — once all specs are processed, the agent creates a new branch (`ai-fix/<base>-<timestamp>`), commits the fixes, pushes.

### Environment variables

| Variable | Default | Description |
|----------|---------|-------------|
| `OPENAI_API_KEY` | — | **Required.** OpenAI API key. |
| `AI_MODEL` | `gpt-4o` | Model used for classification and patch generation. |
| `AI_MAX_ITERATIONS` | `3` | Maximum fix attempts per failing test before giving up. |

### Flags

| Flag | Effect |
|------|--------|
| `--dry-run` | Applies patches but skips Cypress re-run and Git push. |
| `--skip-verify` | Applies patches without re-running Cypress (still pushes). |

### Usage

```bash
# Normal run
node scripts/ai-fix-agent.mjs

# Inspect patches without running tests or pushing
node scripts/ai-fix-agent.mjs --dry-run
```