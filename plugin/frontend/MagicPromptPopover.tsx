import { useState } from 'react'
import { Check, Copy, CornerDownLeft, Loader2, WandSparkles, X } from 'lucide-react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { api } from '../api/client'
import { copyToClipboard } from '../utils/clipboard'
import { i18nT } from '../i18n/t'
import { Btn, IconButton } from './ui'
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover'
import SimpleSelect from './SimpleSelect'
import ErrorNotice from './ErrorNotice'

/* "Magic prompt" plugin: rewrite a rough prompt into a better one, grounded in the
   session's history (the server builds that snapshot), on a model the viewer picks.
   The result is copied or dropped into the composer by the viewer; nothing is sent. */

const MODEL_KEY = 'kirocrew.magicPrompt.model'
const AUTO = 'auto'

function storedModel(): string {
  try { return localStorage.getItem(MODEL_KEY) || AUTO } catch { return AUTO }
}

interface MagicResult { optimized: string; context_used: boolean }

class MagicPromptError extends Error {
  declined: boolean
  constructor(declined: boolean) { super('magic prompt failed'); this.declined = declined }
}

export default function MagicPromptPopover({ slotId, draft, onUse, disabled }: {
  slotId: string
  /** The composer's current text; prefills the panel each time it opens empty. */
  draft: string
  /** Puts the result into the composer. */
  onUse: (text: string) => void
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [input, setInput] = useState('')
  const [model, setModel] = useState(storedModel)
  const [copied, setCopied] = useState(false)

  const { data: models = [] } = useQuery<string[]>({
    queryKey: ['magic-prompt-models'],
    enabled: open,
    queryFn: async () => {
      const rows = await api.models()
      if (!Array.isArray(rows)) return []
      return rows.flatMap((r: { model_name?: string; name?: string }) => {
        const name = r.model_name || r.name
        return name && name !== AUTO ? [name] : []
      })
    },
  })

  const run = useMutation<MagicResult, MagicPromptError, void>({
    mutationFn: async () => {
      const resp = await fetch(`/api/chat/slots/${encodeURIComponent(slotId)}/magic-prompt`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-session-key': 'dashboard:ui' },
        credentials: 'same-origin',
        body: JSON.stringify({ prompt: input, model }),
      })
      if (!resp.ok) throw new MagicPromptError(resp.status === 422)
      return resp.json()
    },
    onMutate: () => setCopied(false),
  })

  const pickModel = (next: string) => {
    setModel(next)
    try { localStorage.setItem(MODEL_KEY, next) } catch { /* the choice just won't persist */ }
  }
  const result = run.data?.optimized ?? ''
  // A stored model that is no longer listed stays selectable, so the choice never silently changes.
  const options = model === AUTO || models.includes(model) ? models : [model, ...models]

  return (
    <Popover open={open} onOpenChange={next => {
      setOpen(next)
      if (next && !input.trim() && draft.trim()) setInput(draft)
    }}>
      <PopoverTrigger asChild>
        <IconButton
          aria-label={i18nT('components.magicPrompt.button_label')}
          title={i18nT('components.magicPrompt.button_label')}
          variant={open ? 'active' : 'default'}
          disabled={disabled}
          className="h-8 px-2 rounded-lg shrink-0 flex items-center gap-1"
        >
          <WandSparkles className="lucide-inline shrink-0" aria-hidden />
        </IconButton>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="end"
        className="w-[min(calc(100vw-1rem),34rem)] max-h-[min(80vh,44rem)] overflow-y-auto p-4 text-[12px]"
      >
        <div className="flex items-start justify-between gap-3 mb-3">
          <div className="min-w-0">
            <h2 className="flex items-center gap-2 text-sm font-semibold text-text">
              <WandSparkles className="lucide-inline text-accent shrink-0" aria-hidden />
              {i18nT('components.magicPrompt.title')}
            </h2>
            <p className="mt-1 text-[11px] leading-relaxed text-muted">{i18nT('components.magicPrompt.description')}</p>
          </div>
          <IconButton aria-label={i18nT('components.magicPrompt.close')} onClick={() => setOpen(false)}>
            <X className="lucide-inline" aria-hidden />
          </IconButton>
        </div>

        <div className="text-[11px] text-muted mb-1">{i18nT('components.magicPrompt.model_label')}</div>
        <div className="mb-3">
          <SimpleSelect
            aria-label={i18nT('components.magicPrompt.model_label')}
            options={[AUTO, ...options]}
            optionLabels={[i18nT('components.magicPrompt.model_default'), ...options]}
            value={model}
            onChange={pickModel}
          />
        </div>

        <div className="text-[11px] text-muted mb-1">{i18nT('components.magicPrompt.input_label')}</div>
        <textarea
          aria-label={i18nT('components.magicPrompt.input_label')}
          className="w-full bg-bg-elevated border border-border rounded-md px-3 py-2 text-text text-sm font-body outline-hidden resize-y min-h-[88px] focus-ring"
          placeholder={i18nT('components.magicPrompt.input_placeholder')}
          value={input}
          onChange={e => setInput(e.target.value)}
        />
        <div className="mt-2 flex justify-end">
          <Btn primary disabled={!input.trim() || run.isPending} onClick={() => run.mutate()}>
            {run.isPending ? <Loader2 className="lucide-inline animate-spin" aria-hidden /> : <WandSparkles className="lucide-inline" aria-hidden />}
            {i18nT(run.isPending ? 'components.magicPrompt.optimizing' : 'components.magicPrompt.optimize')}
          </Btn>
        </div>

        {/* No hand-off: the rough prompt typed above is an unsaved draft the panel must keep. */}
        <ErrorNotice
          message={run.error ? i18nT(run.error.declined ? 'components.magicPrompt.error_declined' : 'components.magicPrompt.error_generic') : undefined}
          variant="inline"
          onDismiss={() => run.reset()}
        />

        {result && (
          <div className="mt-3" aria-live="polite">
            <div className="text-[11px] text-muted mb-1">{i18nT('components.magicPrompt.result_label')}</div>
            <textarea
              aria-label={i18nT('components.magicPrompt.result_label')}
              readOnly
              className="w-full bg-bg border border-border rounded-md px-3 py-2 text-text text-sm font-body outline-hidden resize-y min-h-[120px] focus-ring"
              value={result}
            />
            <p className="mt-1 text-[11px] text-muted">
              {i18nT(run.data?.context_used ? 'components.magicPrompt.context_used' : 'components.magicPrompt.context_missing')}
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <Btn onClick={async () => { setCopied(await copyToClipboard(result)) }}>
                {copied ? <Check className="lucide-inline" aria-hidden /> : <Copy className="lucide-inline" aria-hidden />}
                {i18nT(copied ? 'components.magicPrompt.copied' : 'components.magicPrompt.copy')}
              </Btn>
              <Btn primary onClick={() => { onUse(result); setOpen(false) }}>
                <CornerDownLeft className="lucide-inline" aria-hidden />
                {i18nT('components.magicPrompt.use_in_chat')}
              </Btn>
            </div>
          </div>
        )}
      </PopoverContent>
    </Popover>
  )
}
