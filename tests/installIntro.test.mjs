import test from 'node:test'
import assert from 'node:assert/strict'
import {
  INSTALL_INTRO_STORAGE_KEY,
  installationPlatform,
  isStandaloneApp,
  readInstallIntroSeen,
  writeInstallIntroSeen,
} from '../src/services/installIntro.js'

test('installation artwork selects iOS for iPhone, iPad and touch-mode iPadOS', () => {
  assert.equal(installationPlatform({ userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)' }), 'ios')
  assert.equal(installationPlatform({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X)' }), 'ios')
  assert.equal(installationPlatform({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 5 }), 'ios')
})

test('all other platforms use the requested Android artwork fallback', () => {
  assert.equal(installationPlatform({ userAgent: 'Mozilla/5.0 (Linux; Android 15)' }), 'android')
  assert.equal(installationPlatform({ userAgent: 'Mozilla/5.0 (Windows NT 10.0)' }), 'android')
  assert.equal(installationPlatform({ userAgent: 'Mozilla/5.0 (Macintosh)', platform: 'MacIntel', maxTouchPoints: 0 }), 'android')
})

test('standalone detection supports the web manifest and legacy iOS property', () => {
  assert.equal(isStandaloneApp({}), false)
  assert.equal(isStandaloneApp({ matchesDisplayMode: true }), true)
  assert.equal(isStandaloneApp({ navigatorStandalone: true }), true)
})

test('one-time marker survives storage and degrades safely when unavailable', () => {
  const values = new Map()
  const storage = { getItem: key => values.get(key) ?? null, setItem: (key, value) => values.set(key, value) }
  assert.equal(readInstallIntroSeen(storage), false)
  writeInstallIntroSeen(storage)
  assert.equal(values.get(INSTALL_INTRO_STORAGE_KEY), '1')
  assert.equal(readInstallIntroSeen(storage), true)
  assert.doesNotThrow(() => writeInstallIntroSeen({ setItem() { throw new Error('blocked') } }))
  assert.equal(readInstallIntroSeen({ getItem() { throw new Error('blocked') } }), false)
})
