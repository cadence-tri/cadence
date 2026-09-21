export const INSTALL_INTRO_STORAGE_KEY = 'cadence.installIntroSeen.v1'

/** iPadOS can identify itself as a Mac, so touch capability is part of iOS detection. */
export function installationPlatform({ userAgent = '', platform = '', maxTouchPoints = 0 } = {}) {
  const ua = String(userAgent)
  const ipadDesktopMode = platform === 'MacIntel' && maxTouchPoints > 1
  return /iPad|iPhone|iPod/i.test(ua) || ipadDesktopMode ? 'ios' : 'android'
}

export function isStandaloneApp({ matchesDisplayMode = false, navigatorStandalone = false } = {}) {
  return matchesDisplayMode || navigatorStandalone
}

export function readInstallIntroSeen(storage) {
  try {
    return storage?.getItem(INSTALL_INTRO_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

export function writeInstallIntroSeen(storage) {
  try {
    storage?.setItem(INSTALL_INTRO_STORAGE_KEY, '1')
  } catch {
    // The in-memory screen state still advances when storage is unavailable.
  }
}
