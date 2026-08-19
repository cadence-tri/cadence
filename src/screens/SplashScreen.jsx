import logo from '../assets/cadence-logo.png'

export default function SplashScreen() {
  return (
    <div className="fixed inset-0 flex items-center justify-center bg-white">
      <img src={logo} alt="Cadence" className="w-40 max-w-[70vw]" />
    </div>
  )
}
