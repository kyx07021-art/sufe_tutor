/**
 * M0 input component interaction smoke (dev server + Playwright)
 * - Covers: dropdown multi-column panel / check button / input filtering / combo input select-fill / variable input set add-remove / info input area status marks.
 */
import { chromium } from 'playwright'

const BASE = process.env.BASE || 'http://localhost:5199'
const errors = []
const browser = await chromium.launch()
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } })
page.on('console', (m) => m.type() === 'error' && errors.push('console: ' + m.text()))
page.on('pageerror', (e) => errors.push('pageerror: ' + e.message))

await page.goto(BASE + '/', { waitUntil: 'networkidle' })

// -- dropdown multi-column panel (16 subjects -> 2 columns) --
await page.locator('.ui-dropdown').nth(1).click()
await page.waitForTimeout(400)
const cols = await page.evaluate(() => {
  const grid = document.querySelector('.ui-droppanel__grid')
  return grid ? grid.style.gridTemplateColumns : ''
})
if (!cols.includes('repeat(2')) errors.push('subject dropdown should be 2 columns: ' + cols)
await page.locator('.ui-droppanel__item').first().click()
await page.waitForTimeout(300)

// -- check button --
const cb = page.locator('.ui-checkbtn').first()
await cb.click()
await page.waitForTimeout(300)
if (!(await cb.evaluate((el) => el.classList.contains('is-checked')))) errors.push('check A did not select')
const cbWidth = await cb.evaluate((el) => el.offsetWidth)
await cb.click()
await page.waitForTimeout(300)
if (await cb.evaluate((el) => el.classList.contains('is-checked'))) errors.push('check A did not deselect')
const cbWidth2 = await cb.evaluate((el) => el.offsetWidth)
if (cbWidth2 >= cbWidth) errors.push('check A did not shrink after deselect')

// -- input filtering (digits only) --
const numInput = page.locator('.ui-input__ta').nth(1)
await numInput.fill('a12b34')
const numVal = await numInput.inputValue()
if (numVal !== '1234') errors.push('digits filter failed: ' + numVal)

// -- combo input: select fills --
await page.locator('.ui-combo__v').click()
await page.waitForTimeout(400)
const comboPanel = page.locator('.ui-droppanel').count()
if (comboPanel < 1) errors.push('combo input dropdown did not open')
await page.locator('.ui-droppanel__item').first().click()
await page.waitForTimeout(300)
const comboInputVal = await page.locator('.ui-combo .ui-input__ta').first().inputValue()
if (!comboInputVal) errors.push('combo input did not fill after select')

// -- variable input set: add + remove row --
const varSetSec = page.locator('.pv__sec', { hasText: 'Variable Input' })
const beforeRows = await varSetSec.locator('.ui-varset__row').count()
await varSetSec.locator('.ui-varset__add').click()
await page.waitForTimeout(200)
const afterRows = await varSetSec.locator('.ui-varset__row').count()
if (afterRows !== beforeRows + 1) errors.push('add row failed')
await varSetSec.locator('.ui-varset__remove').nth(1).click()
await page.waitForTimeout(200)
const afterRemove = await varSetSec.locator('.ui-varset__row').count()
if (afterRemove !== beforeRows) errors.push('remove row failed')

// -- info input area status marks --
const fieldSec = page.locator('.pv__sec', { hasText: 'Info Input Area' })
// required unfilled -> red star
const redStar = await fieldSec.locator('.ui-fieldinput--required-empty .ui-fieldinput__mark-icon').count()
if (redStar < 1) errors.push('required empty should show red star')
// optional unfilled -> yellow star
const yellowStar = await fieldSec.locator('.ui-fieldinput--optional-empty .ui-fieldinput__mark-icon').count()
if (yellowStar !== 1) errors.push('optional empty should show yellow star')
// interact with optional (schedule input focus) -> yellow star disappears
const fieldInputs = fieldSec.locator('.ui-input__ta')
await fieldInputs.nth(1).focus()
await page.waitForTimeout(200)
await fieldInputs.nth(1).blur()
await page.waitForTimeout(200)
const yellowAfterTouch = await fieldSec.locator('.ui-fieldinput--optional-empty').count()
if (yellowAfterTouch !== 0) errors.push('yellow star should disappear after interaction (optional -> touched)')
// fill required -> green check
await fieldInputs.nth(0).fill('Higher Math')
await page.waitForTimeout(200)
const greenCheck = await fieldSec.locator('.ui-fieldinput--filled .ui-fieldinput__mark-icon').count()
if (greenCheck !== 1) errors.push('filled should show green check')

await browser.close()
if (errors.length) {
  console.log('INPUT SMOKE FAIL')
  errors.forEach((e) => console.log(' - ' + e))
  process.exit(1)
} else {
  console.log('INPUT SMOKE PASS')
}
