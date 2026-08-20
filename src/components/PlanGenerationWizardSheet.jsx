import { useState } from 'react'
import { Wand2, Copy, Check } from 'lucide-react'
import Sheet from './Sheet'
import { buildCheckInPrompt } from '../services/planPromptBuilder'
import { mostRecentBlock } from '../services/planBlockTrigger'
import { capacityWarningMessage } from '../services/trainingCapacityWarning'
import { importMarkdown } from '../services/markdownImporter'

/** The "how'd it go, generate the next 2 weeks" wizard. Ported from
 * PlanGenerationWizardView.swift, minus the Smart Coach one-tap path (cut
 * from the PWA per HANDOFF_PWA.md — copy/paste into an AI chat is now
 * the only generation path). */
export default function PlanGenerationWizardSheet({ profile, allSessions, weekPhases, onClose }) {
  const isPlanEmpty = allSessions.length === 0
  const [stage, setStage] = useState('note') // note | prompt | pasteBack | result
  const [note, setNote] = useState('')
  const [prompt, setPrompt] = useState('')
  const [pastedReply, setPastedReply] = useState('')
  const [copied, setCopied] = useState(false)
  const [summary, setSummary] = useState(null)
  const [error, setError] = useState(null)
  const [showDetails, setShowDetails] = useState(false)

  const buildPrompt = () => {
    setError(null)
    try {
      const block = mostRecentBlock(allSessions)
      const capacityWarningText = capacityWarningMessage({
        sport: profile.sport,
        runningDistance: profile.runningDistance,
        triathlonDistance: profile.triathlonDistance,
        trainingDaysPerWeek: profile.trainingDaysPerWeek,
      })
      const text = buildCheckInPrompt({ profile, recentSessions: block, weekPhases, athleteNote: note, capacityWarningText })
      setPrompt(text)
      setCopied(false)
      setStage('prompt')
    } catch (e) {
      setError(e.message)
    }
  }

  const copyPrompt = async () => {
    try {
      await navigator.clipboard.writeText(prompt)
      setCopied(true)
    } catch {
      setError('Could not copy automatically — select and copy the text manually.')
    }
  }

  const commitImport = async (markdown) => {
    setError(null)
    try {
      const result = await importMarkdown(markdown)
      setSummary(result)
      setStage('result')
    } catch (e) {
      setError(e.message)
    }
  }

  return (
    <Sheet title={isPlanEmpty ? 'It starts here!' : 'Next 2 Weeks'} onClose={onClose}>
      <div className="p-4 flex flex-col gap-4">
        {stage === 'note' && (
          <>
            <Wand2 size={36} className="text-accent" />
            <h3 className="font-display font-bold text-xl text-main-text">
              {isPlanEmpty ? "Let's start training!" : 'How did the last block go?'}
            </h3>
            <p className="text-sm text-minor-text">
              {isPlanEmpty
                ? 'Tell me more about you. What are you training for? What are your past results (race, training, best efforts)? Any major injury I should be aware of or anything else you consider worth raising before we start?'
                : "Anything worth flagging before the next 2 weeks are generated — fatigue, a niggle, a session that felt great, a schedule conflict coming up. Leave it blank to just continue the plan as progressed."}
            </p>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={6}
              className="w-full p-3 rounded-xl bg-panel text-main-text outline-none resize-none"
            />
            <button onClick={buildPrompt} className="w-full py-2.5 rounded-xl bg-accent text-white font-semibold">
              Build check-in prompt to copy
            </button>
          </>
        )}

        {stage === 'prompt' && (
          <>
            <h3 className="font-display font-bold text-xl text-main-text">Copy this into your AI coach</h3>
            <p className="text-sm text-minor-text">Open your favorite AI, paste this whole message, and send it.</p>
            <div className="max-h-64 overflow-y-auto p-2.5 rounded-xl bg-panel">
              <pre className="text-[11px] font-mono text-main-text whitespace-pre-wrap break-words">{prompt}</pre>
            </div>
            <button
              onClick={copyPrompt}
              className="w-full py-2.5 rounded-xl bg-accent text-white font-semibold flex items-center justify-center gap-2"
            >
              {copied ? <Check size={16} /> : <Copy size={16} />} {copied ? 'Copied ✓' : 'Copy prompt'}
            </button>
            <button
              onClick={() => setStage('pasteBack')}
              disabled={!copied}
              className="w-full py-2.5 rounded-xl border border-accent text-accent font-semibold disabled:opacity-40"
            >
              Continue → paste Coach&apos;s reply
            </button>
          </>
        )}

        {stage === 'pasteBack' && (
          <>
            <h3 className="font-display font-bold text-xl text-main-text">Paste Coach&apos;s reply</h3>
            <p className="text-sm text-minor-text">
              Copy your AI Coach&apos;s entire reply from the chat and paste it below. Tap Import to save your plan
              and start training.
            </p>
            <textarea
              value={pastedReply}
              onChange={(e) => setPastedReply(e.target.value)}
              rows={10}
              className="w-full p-3 rounded-xl bg-panel text-main-text outline-none resize-none font-mono text-xs"
            />
            <div className="flex gap-2.5">
              <button onClick={() => setStage('prompt')} className="flex-1 py-2.5 rounded-xl border border-accent text-accent font-semibold">
                Back
              </button>
              <button
                onClick={() => commitImport(pastedReply)}
                disabled={!pastedReply.trim()}
                className="flex-[2] py-2.5 rounded-xl bg-accent text-white font-semibold disabled:opacity-40"
              >
                Import these 2 weeks
              </button>
            </div>
          </>
        )}

        {stage === 'result' && summary && (
          <>
            <h3 className="font-display font-bold text-xl text-main-text">
              Imported {summary.imported} session(s)
            </h3>
            {summary.skippedDuplicates > 0 && (
              <p className="text-sm text-minor-text">Skipped {summary.skippedDuplicates} already in your log.</p>
            )}
            {(summary.warnings.length > 0 || summary.failedItems.length > 0) && (
              <>
                <button onClick={() => setShowDetails((v) => !v)} className="text-xs font-semibold text-accent self-start">
                  {showDetails ? 'Hide details' : 'Show details'}
                </button>
                {showDetails && (
                  <div className="p-3 rounded-xl bg-panel flex flex-col gap-1.5">
                    {summary.warnings.map((w, i) => (
                      <p key={i} className="text-xs text-minor-text">
                        ⚠ {w}
                      </p>
                    ))}
                    {summary.failedItems.map((f, i) => (
                      <p key={i} className="text-xs text-red-500">
                        ✕ {f}
                      </p>
                    ))}
                  </div>
                )}
              </>
            )}
          </>
        )}

        {error && <div className="p-3 rounded-xl bg-red-500/10 text-sm text-red-600">{error}</div>}
      </div>
    </Sheet>
  )
}
