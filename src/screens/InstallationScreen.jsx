import installIos from '../../figures/install-ios.png'
import installAndroid from '../../figures/install-android.png'
import { installationPlatform } from '../services/installIntro'

function currentPlatform() {
  if (typeof navigator === 'undefined') return 'android'
  return installationPlatform({
    userAgent: navigator.userAgent,
    platform: navigator.platform,
    maxTouchPoints: navigator.maxTouchPoints,
  })
}

/** One-time browser introduction shown after the splash and before profile setup.
 * The supplied figure already contains the visual button; this transparent
 * semantic button makes that exact region interactive and keyboard accessible. */
export default function InstallationScreen({ onContinue }) {
  const platform = currentPlatform()
  const ios = platform === 'ios'
  const figure = ios ? installIos : installAndroid
  const browser = ios ? 'Safari' : 'Chrome'

  return (
    <main className="fixed inset-0 z-40 flex items-center justify-center overflow-hidden bg-background">
      <div className="installation-figure">
        <img
          src={figure}
          alt={ios
            ? 'iOS installation instructions: in Safari, tap Share, choose Add to Home Screen, then tap Add.'
            : 'Android installation instructions: in Chrome, open the menu, choose Install app, then confirm Install.'}
          className="absolute inset-0 h-full w-full"
        />
        <button
          type="button"
          onClick={onContinue}
          aria-label={`Continue in ${browser} to create your Cadence profile`}
          className="absolute left-[7%] top-[80.5%] h-[8.5%] w-[86%] rounded-[2rem] focus-visible:outline-4 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <span className="sr-only">Continue in {browser}</span>
        </button>
      </div>
    </main>
  )
}
