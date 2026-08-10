// File: frontend/e2e/pasada_full_ux.spec.ts
import { test, expect } from '@playwright/test';

// Use serial mode so it signs up first, then logs in for the rest of the tests
test.describe.configure({ mode: 'serial' });

test.describe('PASADA Comprehensive E2E & UX Test Suite', () => {

  test('UX: Complete Signup Flow', async ({ page }) => {
    // 1. Visit Login Page and go to Signup
    await page.goto('http://localhost:3000');
    
    // Wait for the "Connecting to server..." spinner to finish
    await page.waitForSelector('button:has-text("Log In")', { timeout: 15000 });
    
    // Click Register
    await page.click('button:has-text("Register Account")', { force: true });
    await page.waitForURL('**/signup');

    // 2. Fill out the Signup Form
    await page.fill('input[type="text"] >> nth=0', 'PLAYWRIGHT'); // First Name
    await page.fill('input[type="text"] >> nth=1', 'TESTER');     // Last Name
    await page.fill('input[type="password"]', 'password123');

    // 3. Submit and wait for redirect back to login
    // We catch the browser alert "Account created successfully!"
    page.once('dialog', dialog => dialog.accept());
    await page.click('button:has-text("Complete Registration")', { force: true });
    await page.waitForURL('http://localhost:3000/');
  });

  test.beforeEach(async ({ page }) => {
    // Before every subsequent test, log in using the newly created credentials
    await page.goto('http://localhost:3000');
    await page.waitForSelector('button:has-text("Log In")', { timeout: 15000 });
    
    await page.fill('input[placeholder="E.g. JUAN DELA CRUZ"]', 'PLAYWRIGHT TESTER');
    await page.fill('input[type="password"]', 'password123'); 
    await page.click('button:has-text("Log In")', { force: true }); // Force click bypasses Next.js dev overlay

    // Verify Navigation to Dashboard
    await page.waitForURL('**/dashboard');
    await expect(page.locator('text=Franchise Registry Dashboard')).toBeVisible();
  });

  test('UX: Dark Mode Toggle visually adapts UI', async ({ page }) => {
    const html = page.locator('html');
    const themeButton = page.locator('button.rounded-full.bg-card.absolute.top-6.right-6');

    // Click to toggle Dark Mode
    await themeButton.click({ force: true });
    await expect(html).toHaveClass(/dark/);

    // Toggle back to Light Mode
    await themeButton.click({ force: true });
    await expect(html).not.toHaveClass(/dark/);
  });

  test('Dashboard: Visual charts and route cards render correctly', async ({ page }) => {
    await expect(page.locator('text=Total Registered Operators')).toBeVisible();
    await expect(page.locator('text=Active Operators')).toBeVisible();
    await expect(page.locator('text=Route Distribution')).toBeVisible();
    await expect(page.locator('text=Route Density Analysis')).toBeVisible();
  });

  test('TODA Line: Full Operator Add, Edit, Manual Date Override, and Search Cycle', async ({ page }) => {
    // 1. Navigate to BATODA Line
    await page.goto('http://localhost:3000/toda/BATODA');
    await expect(page.locator('h2:has-text("BATODA")')).toBeVisible();

    // 2. Open Add Operator Modal
    await page.click('button:has-text("Add Operator")', { force: true });
    await expect(page.locator('text=Add Operator / Slot')).toBeVisible();

    // 3. Fill Form with Manual Date Overrides
    await page.fill('input[name="operator_name"]', 'AUTOMATED E2E TESTER');
    await page.fill('input[name="address"]', 'MARAGONDON HIGHWAY');
    await page.fill('input[name="make"]', 'HONDA');
    await page.fill('input[name="motor_no"]', 'E2E-MTR-999');
    await page.fill('input[name="chassis_no"]', 'E2E-CHS-888');
    await page.fill('input[name="plate_no"]', '999-E2E');
    
    await page.fill('input[name="issue_date"]', '2026-08-10');
    await page.fill('input[name="valid_until"]', '2026-12-31');

    await page.click('button:has-text("Save Operator")', { force: true });

    // Wait for modal to disappear
    await expect(page.locator('text=Add Operator / Slot')).not.toBeVisible();

    // 4. Verify Operator Appears in Table via Search
    await page.fill('input[placeholder*="Search Operator"]', 'AUTOMATED E2E');
    await expect(page.locator('text=AUTOMATED E2E TESTER')).toBeVisible();

    // 5. Test Edit Modal functionality
    await page.click('button[title="Edit Operator"]', { force: true });
    await expect(page.locator('text=Edit / Renew Operator')).toBeVisible();
    await page.fill('input[name="address"]', 'UPDATED E2E ADDRESS');
    await page.click('button:has-text("Save Changes")', { force: true });

    await expect(page.locator('text=AUTOMATED E2E TESTER')).toBeVisible();
  });

  test('TODA Line: Dropdowns visual visibility and accessibility', async ({ page }) => {
    await page.goto('http://localhost:3000/toda/BATODA');

    // Check Sort Dropdown Visibility
    const sortSelect = page.locator('select').first();
    await expect(sortSelect).toBeVisible();
    await sortSelect.selectOption('NAME_ASC');

    // Check Filter Dropdown Visibility
    const filterSelect = page.locator('select').nth(1);
    await expect(filterSelect).toBeVisible();
    await filterSelect.selectOption('ACTIVE');
  });

  test('Batch Print: Modal opens and date range options function', async ({ page }) => {
    await page.goto('http://localhost:3000/toda/BATODA');
    
    await page.click('button:has-text("Batch Print")', { force: true });
    await expect(page.locator('text=Print Documents')).toBeVisible();

    const dateFilterSelect = page.locator('select').last();
    await dateFilterSelect.selectOption('SPECIFIC_DATE');

    await expect(page.locator('text=Select Date')).toBeVisible();
  });
});