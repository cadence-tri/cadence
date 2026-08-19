import wordmark from '../assets/cadence-wordmark.jpg'

/** Shown briefly on cold launch, before ContentView reveals either the
 * main app or LoginScreen. Uses the full wordmark lockup (not the square
 * app icon) since the icon's cream background reads as an odd boxed-in
 * shape against a plain white splash — the wordmark already has a white
 * background, so it blends straight into the page. */
export default function SplashScreen() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-white">
      <img src={wordmark} alt="Cadence" className="w-64 max-w-[70vw]" />
    </div>
  )
}
