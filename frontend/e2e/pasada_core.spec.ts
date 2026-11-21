// PASADA core E2E: login -> search -> renewal -> account switch.
//
// Runs against the REAL desktop stack (real FastAPI backend + real SQLite +
// the production static export the Tauri webview loads), not a dev server.
// See e2e/support/servers.ts for how that stack is booted, and why this is
// the faithful way to test a Tauri desktop app on Linux AND Windows.
//
// The four flows below are the ones the audit flagged as untested. They are
// pure frontend<->backend HTTP, so they exercise identical code on both OSes.
// The only things NOT covered here are the thin Rust shell commands (updater,
// PDF print fallback, native context menu); those are covered by cargo check
// plus manual release testing (see docs/TESTING_ON_LINUX.md).
import { test, expect, type APIRequestContext, type Page } from '@playwright/test';

// Fixed credentials for the seeded office. The backend upper-cases usernames
// on submit, so we type uppercase to match what the UI produces.
const ADMIN = { first: 'E2E', last: 'ADMIN', user: 'E2E ADMIN', pass: 'password123' };
const CLERK = { first: 'E2E', last: 'CLERK', user: 'E2E CLERK', pass: 'password123' };
const ROUTE = 'BATODA';
const OPERATOR = 'E2E RENEWAL SUBJECT';

// The Playwright `request` fixture and `page.request` inherit the frontend
// baseURL (localhost:3000). Every backend call must use the absolute API
// origin, matching the frontend's hardcoded API_URL in lib/api.ts.
const API = 'http://127.0.0.1:43888';

async function loginViaApi(request: APIRequestContext, user: string, pass: string): Promise<string> {
  const res = await request.post(`${API}/token`, { data: { username: user, password: pass } });
  expect(res.ok(), `API login for ${user} should succeed`).toBeTruthy();
  const body = await res.json();
  return body.access_token as string;
}

async function authedPost(request: APIRequestContext, token: string, path: string, data: unknown) {
  return request.post(`${API}${path}`, { data, headers: { Authorization: `Bearer ${token}` } });
}

async function authedGet(request: APIRequestContext, token: string, path: string) {
  return request.get(`${API}${path}`, { headers: { Authorization: `Bearer ${token}` } });
}

async function authedPut(request: APIRequestContext, token: string, path: string, data: unknown) {
  return request.put(`${API}${path}`, { data, headers: { Authorization: `Bearer ${token}` } });
}

// Seed a fresh office over the real API: promote the first account to Admin
// via bootstrap, create a Clerk (the deactivation target), and one operator to
// renew. This mirrors what the UI does, just without the clicks, so the flows
// under test start from a realistic, deterministic state.
async function seedOffice(request: APIRequestContext) {
  // First account via signup (open only while the office has no account).
  const signup = await request.post(`${API}/signup`, {
    data: {
      first_name: ADMIN.first, last_name: ADMIN.last, username: ADMIN.user,
      password: ADMIN.pass, password_confirm: ADMIN.pass, role: 'Clerk',
    },
  });
  expect(signup.ok(), 'first-run signup should succeed on a fresh office').toBeTruthy();

  const adminToken = await loginViaApi(request, ADMIN.user, ADMIN.pass);

  // Promote the first account to the office Admin (first-run bootstrap).
  const bootstrap = await authedPost(request, adminToken, '/admin/bootstrap', { password: ADMIN.pass });
  expect(bootstrap.ok(), 'bootstrap should promote the first account to Admin').toBeTruthy();

  // A Clerk, used as the deactivation target in the account-switch flow.
  const mkClerk = await authedPost(request, adminToken, '/users', {
    first_name: CLERK.first, last_name: CLERK.last, username: CLERK.user,
    password: CLERK.pass, password_confirm: CLERK.pass, role: 'Clerk',
  });
  expect(mkClerk.ok(), 'creating the Clerk should succeed').toBeTruthy();

  // One operator on BATODA for the renewal flow to edit.
  const mkOperator = await authedPost(request, adminToken, '/api/operators', {
    operator_name: OPERATOR, route: ROUTE, address: 'E2E TEST ROAD',
    make: 'HONDA', plate_no: '2026-9999', motor_no: 'E2E-MOTOR', chassis_no: 'E2E-CHASSIS',
  });
  expect(mkOperator.ok(), 'seeding the renewal-target operator should succeed').toBeTruthy();

  return adminToken;
}

// Drive the real login form and land on the dashboard.
async function loginViaUi(page: Page, user: string, pass: string) {
  await page.goto('/');
  // The login screen polls /health and shows a spinner until the backend is up.
  await page.waitForSelector('button:has-text("Log In")', { timeout: 30000 });
  await page.fill('input[placeholder="E.g. JUAN DELA CRUZ"]', user);
  await page.fill('input[type="password"]', pass);
  await page.click('button:has-text("Log In")');
  // The static export serves /dashboard/ (folder + trailing slash), so match
  // tolerantly rather than the exact '**/dashboard' glob.
  await page.waitForURL(/\/dashboard\/?$/, { timeout: 30000 });
}

test.describe.configure({ mode: 'serial' });

test.describe('PASADA core flows (real desktop stack)', () => {
  let adminToken: string;

  test.beforeEach(async ({ page }) => {
    // The first-run guided tour is a driver.js overlay that intercepts clicks;
    // mark it seen before the app boots so it never covers the UI under test.
    await page.addInitScript(() => localStorage.setItem('pasada_tour_done', '1'));
  });

  test.beforeAll(async ({ request }) => {
    adminToken = await seedOffice(request);
  });

  test('FLOW 1 — login: signs in with seeded credentials and reaches the dashboard', async ({ page }) => {
    await loginViaUi(page, ADMIN.user, ADMIN.pass);
    await expect(page.locator('text=Franchise Registry Dashboard')).toBeVisible({ timeout: 30000 });
  });

  test('FLOW 2 — search: the seeded operator is findable from the global search page', async ({ page }) => {
    await loginViaUi(page, ADMIN.user, ADMIN.pass);
    await page.goto('/search');
    await expect(page.locator('text=Global Registry Search')).toBeVisible({ timeout: 30000 });
    await page.fill('input[placeholder="Search across all TODAs..."]', OPERATOR);
    // The list filters client-side once records load; assert the row appears.
    await expect(page.locator(`text=${OPERATOR}`)).toBeVisible({ timeout: 30000 });
  });

  test('FLOW 3 — renewal: opening Edit / Renew and saving new dates updates the record', async ({ page }) => {
    await loginViaUi(page, ADMIN.user, ADMIN.pass);
    await page.goto(`/toda/${ROUTE}`);
    await expect(page.locator(`h2:has-text("${ROUTE}")`)).toBeVisible({ timeout: 30000 });

    // Find the seeded operator in the table and open its Edit / Renew modal.
    const row = page.locator('tr', { hasText: OPERATOR }).first();
    await expect(row).toBeVisible({ timeout: 30000 });
    await row.locator('button[aria-label="Edit Operator"]').click();
    await expect(page.locator('text=Edit / Renew Operator')).toBeVisible({ timeout: 30000 });

    // Push validity out a year; the backend treats the change as a renewal.
    const nextYear = String(new Date().getFullYear() + 1);
    await page.fill('input[name="issue_date"]', `${nextYear}-06-15`);
    await page.fill('input[name="valid_until"]', `${nextYear}-12-31`);
    await page.click('button:has-text("Save Changes")');

    // The modal closes on a successful save.
    await expect(page.locator('text=Edit / Renew Operator')).not.toBeVisible({ timeout: 30000 });

    // Confirm persistence through the real API (the same DB the UI wrote to).
    // The record's validity now reflects the renewed year.
    const res = await authedGet(page.request, adminToken, `/franchise/route/${ROUTE}`);
    expect(res.ok()).toBeTruthy();
    const records = await res.json();
    const renewed = (records as Array<Record<string, unknown>>).find(
      (r) => String(r.operator_name) === OPERATOR
    );
    expect(renewed, 'renewed operator should still exist').toBeTruthy();
    expect(String(renewed!.valid_until)).toContain(nextYear);
  });

  test('FLOW 4 — account switch: Admin deactivates the Clerk with a reason; sign-in is refused', async ({ page }) => {
    // Single-key rule (2026-10-14): an Admin switches an account off directly
    // after typing a reason that goes into the audit log. No second-Admin
    // ticket is involved for user accounts.
    await loginViaUi(page, ADMIN.user, ADMIN.pass);
    await page.goto('/admin');
    // OfficeAccounts lives in the Admin Console's Administrative tab.
    await page.click('button:has-text("Administrative")');
    await expect(page.locator('#admin-panel-administrative')).toBeVisible({ timeout: 30000 });

    const clerkRow = page.locator('#admin-panel-administrative tr', { hasText: CLERK.user }).first();
    await expect(clerkRow).toBeVisible({ timeout: 30000 });

    // Wait for the set-active PUT to actually resolve before asserting state
    // (the click kicks off an async fetch).
    const setActiveResponse = page.waitForResponse(
      (r) => r.url().includes('/users/set-active') && r.request().method() === 'PUT'
    );
    await clerkRow.locator('button', { hasText: 'Deactivate' }).click();

    // Confirm the switch, then supply the mandatory reason.
    const dialog = page.locator('[role="alertdialog"]');
    await dialog.getByRole('button', { name: 'Deactivate' }).click();
    await expect(dialog.locator('text=Reason required')).toBeVisible({ timeout: 30000 });
    await dialog.locator('input[type="text"]').fill('E2E: clerk leaves the office');
    await dialog.getByRole('button', { name: 'Continue' }).click();

    const setActive = await setActiveResponse;
    expect(setActive.ok(), `set-active should succeed: ${await setActive.text().catch(() => '')}`).toBeTruthy();

    // The real API shows the account off...
    const users = await authedGet(page.request, adminToken, '/users');
    expect(users.ok()).toBeTruthy();
    const list = await users.json();
    const clerk = (list as Array<Record<string, unknown>>).find((u) => u.username === CLERK.user);
    expect(clerk, 'Clerk should still exist after deactivation').toBeTruthy();
    expect(clerk!.is_deactivated, 'Clerk should now be deactivated').toBe(true);

    // ...and the Clerk can no longer sign in.
    const refused = await page.request.post(`${API}/token`, { data: { username: CLERK.user, password: CLERK.pass } });
    expect(refused.ok(), 'a deactivated account must be refused at sign-in').toBeFalsy();

    // Reactivate so the seeded office is left as it was.
    const reactivate = await authedPut(page.request, adminToken, '/users/set-active', {
      username: CLERK.user, is_active: true, override_reason: 'E2E cleanup',
    });
    expect(reactivate.ok(), `reactivate should succeed: ${reactivate.status()} ${await reactivate.text().catch(() => '')}`).toBeTruthy();
  });
});
