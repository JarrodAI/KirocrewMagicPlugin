import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { screen, fireEvent } from '@testing-library/react'
import { renderWithProviders } from './helpers'
import MagicPromptPopover from '../components/MagicPromptPopover'
import { copyToClipboard } from '../utils/clipboard'

vi.mock('../utils/clipboard', () => ({ copyToClipboard: vi.fn(async () => true) }))

const MODEL_KEY = 'kirocrew.magicPrompt.model'

type Reply = { ok: boolean; status: number; body: unknown }

const stubFetch = (reply: Reply) =>
  vi.fn((url: string) => {
    if (url === '/api/models') {
      return Promise.resolve({
        ok: true,
        json: async () => [{ model_name: 'auto' }, { model_name: 'example-model-pro' }, { model_name: 'example-provider/coding-model-high' }],
      })
    }
    return Promise.resolve({ ok: reply.ok, status: reply.status, json: async () => reply.body })
  })

const open = () => fireEvent.click(screen.getByRole('button', { name: 'Magic prompt' }))
const ok = (optimized: string, contextUsed = true): Reply => ({
  ok: true,
  status: 200,
  body: { optimized, context_used: contextUsed, model: 'auto' },
})

describe('MagicPromptPopover', () => {
  beforeEach(() => localStorage.removeItem(MODEL_KEY))
  afterEach(() => vi.unstubAllGlobals())

  it('prefills from the composer, optimizes on the chosen model, then copies and inserts the result', async () => {
    const fetchMock = stubFetch(ok('Fix the login bug in src/auth/session.ts.'))
    vi.stubGlobal('fetch', fetchMock)
    const onUse = vi.fn()
    renderWithProviders(<MagicPromptPopover slotId="chat-1" draft="fix login" onUse={onUse} />)

    open()
    const input = await screen.findByLabelText('Your rough prompt')
    expect((input as HTMLTextAreaElement).value).toBe('fix login')

    fireEvent.keyDown(await screen.findByRole('combobox', { name: 'Model' }), { key: 'ArrowDown' })
    fireEvent.click(await screen.findByRole('option', { name: 'example-provider/coding-model-high' }))
    fireEvent.click(screen.getByRole('button', { name: 'Optimize' }))

    const result = await screen.findByLabelText('Optimized prompt')
    expect((result as HTMLTextAreaElement).value).toBe('Fix the login bug in src/auth/session.ts.')
    expect(screen.getByText("Used this session's history as context.")).toBeTruthy()

    const post = fetchMock.mock.calls.find(([url]) => String(url).includes('/magic-prompt'))!
    expect(post[0]).toBe('/api/chat/slots/chat-1/magic-prompt')
    expect(JSON.parse((post[1] as { body: string }).body)).toEqual({
      prompt: 'fix login',
      model: 'example-provider/coding-model-high',
    })
    expect(localStorage.getItem(MODEL_KEY)).toBe('example-provider/coding-model-high')

    fireEvent.click(screen.getByRole('button', { name: 'Copy' }))
    await screen.findByRole('button', { name: 'Copied' })
    expect(copyToClipboard).toHaveBeenCalledWith('Fix the login bug in src/auth/session.ts.')

    fireEvent.click(screen.getByRole('button', { name: 'Use in chat' }))
    expect(onUse).toHaveBeenCalledWith('Fix the login bug in src/auth/session.ts.')
  })

  it('remembers the model the viewer chose, even one the list no longer offers', async () => {
    localStorage.setItem(MODEL_KEY, 'retired-model-1')
    vi.stubGlobal('fetch', stubFetch(ok('x')))
    renderWithProviders(<MagicPromptPopover slotId="chat-1" draft="" onUse={vi.fn()} />)
    open()
    expect(await screen.findByRole('combobox', { name: 'Model' })).toHaveTextContent('retired-model-1')
  })

  it('notes when there was no session history, and keeps Optimize off for an empty prompt', async () => {
    vi.stubGlobal('fetch', stubFetch(ok('Better prompt.', false)))
    renderWithProviders(<MagicPromptPopover slotId="chat-1" draft="" onUse={vi.fn()} />)
    open()
    const optimize = await screen.findByRole('button', { name: 'Optimize' })
    expect((optimize as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByLabelText('Your rough prompt'), { target: { value: 'do the thing' } })
    fireEvent.click(optimize)
    expect(await screen.findByText('No session history was available, so only your prompt was used.')).toBeTruthy()
  })

  it.each([
    [502, 'The prompt could not be optimized. Try again or pick another model.'],
    [422, 'That prompt was declined by the input screen.'],
  ])('shows a translated message for an HTTP %i and keeps the typed prompt', async (status, message) => {
    vi.stubGlobal('fetch', stubFetch({ ok: false, status, body: { error: 'server-side english text' } }))
    renderWithProviders(<MagicPromptPopover slotId="chat-1" draft="keep me" onUse={vi.fn()} />)
    open()
    fireEvent.click(await screen.findByRole('button', { name: 'Optimize' }))
    expect(await screen.findByText(message)).toBeTruthy()
    expect(screen.queryByText('server-side english text')).toBeNull()
    expect((screen.getByLabelText('Your rough prompt') as HTMLTextAreaElement).value).toBe('keep me')
  })
})
