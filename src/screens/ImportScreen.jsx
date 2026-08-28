import { useRef, useState } from 'react'
import { useLiveQuery } from 'dexie-react-hooks'
import { GraduationCap, PenSquare, Wand2, DownloadCloud, RotateCcw, Trash2 } from 'lucide-react'
import { db } from '../db/db'
import { encodeBackup, restoreBackup, deleteUpcoming } from '../services/backupService'
import { format } from 'date-fns'

function readFileAsText(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result)
    reader.onerror = reject
    reader.readAsText(file)
  })
}

function downloadJSON(obj, filename) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function PlanImportSection({ onOpenManualEntry, onOpenWizard, allSessions }) {
  const lastImport = allSessions.length ? allSessions.reduce((max, s) => (s.importedAt > max ? s.importedAt : max), allSessions[0].importedAt) : null
  const isPlanEmpty = allSessions.length === 0

  return (
    <div className="flex flex-col items-center gap-5 px-4 text-center">
      <GraduationCap size={44} className="text-accent" />
      <h2 className="font-display font-bold text-xl text-main-text">Cadence Coach</h2>
      <p className="text-sm text-minor-text">
        {isPlanEmpty
          ? "Welcome to Cadence! Let's start building your plan."
          : 'Generate the next two weeks of your training plan or import an existing backup.'}
      </p>

      <button
        onClick={onOpenWizard}
        className="w-full py-2.5 rounded-xl bg-accent text-white font-semibold flex items-center justify-center gap-2"
      >
        <Wand2 size={16} /> {isPlanEmpty ? 'Start a training plan' : 'Generate next 2 weeks'}
      </button>

      <button
        onClick={onOpenManualEntry}
        className="w-full py-2.5 rounded-xl border border-accent text-accent font-semibold flex items-center justify-center gap-2"
      >
        <PenSquare size={16} /> Add activity
      </button>

      <div className="w-full border-t border-minor-text/15 pt-4 flex flex-col gap-1">
        <p className="text-xs text-minor-text">{allSessions.length} sessions in your log</p>
        {lastImport && (
          <p className="text-xs text-minor-text">Last log update: {format(new Date(lastImport), 'MMM d, yyyy, h:mm a')}</p>
        )}
      </div>
    </div>
  )
}

function BackupRestoreSection({ allSessions }) {
  const fileRef = useRef(null)
  const [message, setMessage] = useState(null)
  const [isError, setIsError] = useState(false)
  const [pendingFile, setPendingFile] = useState(null)

  const exportBackup = async () => {
    try {
      const data = await encodeBackup()
      downloadJSON(data, `Cadence-Backup-${format(new Date(), 'yyyy-MM-dd')}.json`)
      setMessage('Backup exported.')
      setIsError(false)
    } catch (err) {
      setMessage(err.message)
      setIsError(true)
    }
  }

  const handlePicked = async (e) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    setPendingFile(file)
  }

  const confirmRestore = async () => {
    if (!pendingFile) return
    try {
      const text = await readFileAsText(pendingFile)
      const count = await restoreBackup(text)
      setMessage(`Restored ${count} session(s) from backup.`)
      setIsError(false)
    } catch (err) {
      setMessage(err.message)
      setIsError(true)
    } finally {
      setPendingFile(null)
    }
  }

  return (
    <div className="flex flex-col items-center gap-4 px-4 text-center">
      <h2 className="font-display font-bold text-lg text-main-text">Backup & Restore</h2>
      <p className="text-sm text-minor-text">
        Export a full backup — every session, completion status, and your feedback. Importing a backup replaces
        everything currently in your log. This is also how you bring in training history exported from the native
        Cadence iOS app — the file formats match.
      </p>

      <button
        onClick={exportBackup}
        disabled={allSessions.length === 0}
        className="w-full py-2.5 rounded-xl border border-accent text-accent font-semibold flex items-center justify-center gap-2 disabled:opacity-40"
      >
        <DownloadCloud size={16} /> Export backup
      </button>

      <button
        onClick={() => fileRef.current?.click()}
        className="w-full py-2.5 rounded-xl border border-accent text-accent font-semibold flex items-center justify-center gap-2"
      >
        <RotateCcw size={16} /> Import backup
      </button>
      <input ref={fileRef} type="file" accept=".json,application/json" className="hidden" onChange={handlePicked} />

      {message && <p className={`text-sm ${isError ? 'text-red-600' : 'text-main-text'}`}>{message}</p>}

      {pendingFile && (
        <div className="w-full p-4 rounded-xl bg-panel flex flex-col gap-3">
          <p className="text-sm text-main-text font-semibold">Import this backup?</p>
          <p className="text-xs text-minor-text">
            This deletes everything currently in your log and replaces it with the backup. This can&apos;t be undone.
          </p>
          <div className="flex gap-2">
            <button onClick={() => setPendingFile(null)} className="flex-1 py-2 rounded-lg border border-minor-text/40 text-main-text text-sm font-semibold">
              Cancel
            </button>
            <button onClick={confirmRestore} className="flex-1 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold">
              Import & Replace
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function DangerZoneSection({ profile }) {
  const [confirming, setConfirming] = useState(false)
  const [message, setMessage] = useState(null)

  const warning = (() => {
    let base = "This removes all sessions from the start of this week onward and resets Stats. Your Training Log of past weeks is kept. This can't be undone."
    if (profile?.competitionDate) {
      const label = profile.competitionName?.trim() || 'your race'
      base += ` You're training for ${label} on ${format(new Date(profile.competitionDate), 'MMM d, yyyy')} — if you haven't exported a backup, this progress will be gone before then.`
    }
    return base
  })()

  const perform = async () => {
    const count = await deleteUpcoming()
    setMessage(`Deleted ${count} session(s) from Upcoming.`)
    setConfirming(false)
  }

  return (
    <div className="flex flex-col items-center gap-4 px-4 text-center">
      <h2 className="font-display font-bold text-lg text-red-500">Danger Zone</h2>
      <p className="text-sm text-minor-text">
        Removes every session from the start of this week onward, and resets Stats accordingly. Your Training Log
        of past weeks is untouched.
      </p>
      <button
        onClick={() => setConfirming(true)}
        className="w-full py-2.5 rounded-xl border border-red-500 text-red-500 font-semibold flex items-center justify-center gap-2"
      >
        <Trash2 size={16} /> Delete Upcoming
      </button>
      {message && <p className="text-sm text-main-text">{message}</p>}

      {confirming && (
        <div className="w-full p-4 rounded-xl bg-panel flex flex-col gap-3">
          <p className="text-sm text-main-text font-semibold">Delete Upcoming?</p>
          <p className="text-xs text-minor-text">{warning}</p>
          <div className="flex gap-2">
            <button onClick={() => setConfirming(false)} className="flex-1 py-2 rounded-lg border border-minor-text/40 text-main-text text-sm font-semibold">
              Cancel
            </button>
            <button onClick={perform} className="flex-1 py-2 rounded-lg bg-red-500 text-white text-sm font-semibold">
              Delete
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

export default function ImportScreen({ profile, onOpenManualEntry, onOpenWizard }) {
  const allSessions = useLiveQuery(() => db.sessions.toArray(), [], [])

  return (
    <div className="flex flex-col gap-8 py-6 pb-10">
      <PlanImportSection onOpenManualEntry={onOpenManualEntry} onOpenWizard={onOpenWizard} allSessions={allSessions} />
      <div className="border-t border-minor-text/15 mx-4" />
      <BackupRestoreSection allSessions={allSessions} />
      <div className="border-t border-minor-text/15 mx-4" />
      <DangerZoneSection profile={profile} />
    </div>
  )
}
