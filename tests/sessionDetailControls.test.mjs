import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'

const source = fs.readFileSync(new URL('../src/components/SessionDetailSheet.jsx', import.meta.url), 'utf8')

test('prescribed rows use explicit accessible Skip text instead of an ambiguous X icon', () => {
  assert.doesNotMatch(source, /\bXCircle\b/)
  assert.doesNotMatch(source, /aria-label="Mark skipped"/)
  assert.match(source, /set\.isSkipped \? 'Skipped' : 'Skip'/)
  assert.match(source, /aria-pressed=\{set\.isSkipped\}/)
  assert.match(source, /Undo skip for/)
  assert.match(source, /w-16 min-h-11/)
})

test('skipping remains wired to the existing mutually exclusive step-status toggle', () => {
  assert.match(source, /onClick=\{setStatus\('skipped'\)\}/)
  assert.match(source, /status === 'done'/)
  assert.match(source, /\{ isCompleted: false, isSkipped: true \}/)
})
