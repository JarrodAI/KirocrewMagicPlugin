# Kirocrew Magic Plugin

A **Magic prompt** button for [KiroCrew](https://github.com/kirodotdev/KiroCrew). It turns a rough prompt into a better one, using the history of your current chat as context, on a model you choose.

> Unofficial community plugin. It is not made or endorsed by the KiroCrew maintainers.

## What you get

A wand icon sits just above the chat box, on the right. Click it and a panel opens:

1. **Model**: pick which model does the rewriting. Your choice is remembered in your browser.
2. **Your rough prompt**: type or paste it, or leave it prefilled from what is already in the chat box.
3. **Optimize**: the tool reads this session's history and writes a sharper prompt.
4. **Copy** the result, or press **Use in chat** to drop it into the chat box. Nothing is ever sent for you.

It is built for two things:

- improving the prompts you send to a session, and
- writing better **auto-nudge** messages (paste the nudge in, optimize it, copy it out).

The tool's built-in instructions say its only job is to optimize the prompt you will give the session. It never answers the prompt and never runs tools.

## Your models, not mine

The model list is read live from **your own KiroCrew**, the same list its normal model picker shows. The plugin ships with no model names and no credentials. "Default (auto)" uses whatever your KiroCrew would use. If you later remove a model you had chosen, it stays selected until you change it, so nothing switches silently.

## Requirements

- A KiroCrew **source checkout** (`git clone https://github.com/kirodotdev/KiroCrew` plus `pip install -e .`). The plugin adds a button to the web UI, which has to be rebuilt, and a pip-only install does not include the UI source.
- Python 3.10 or newer (the installer is one standard-library Python file).
- Node.js and npm, to rebuild the web UI.
- Tested on KiroCrew 0.10.0 source checkouts.

## Install

```bash
git clone https://github.com/JarrodAI/KirocrewMagicPlugin
cd KirocrewMagicPlugin
python install.py install --kirocrew /path/to/KiroCrew --build
```

Then restart KiroCrew and hard-refresh the dashboard. Use `python3` if `python` is not on your path. On Windows, write the path like `C:\code\KiroCrew`.

What `--build` does: runs `npm ci` if the web UI has never been built, then `npm run i18n:pseudo` and `npm run build` inside `/path/to/KiroCrew/website`. Leave `--build` off if you prefer to run those yourself.

Check what is installed any time:

```bash
python install.py status --kirocrew /path/to/KiroCrew
```

## What the installer changes

| Where | What |
|---|---|
| `src/kiro_crew/dashboard/handlers/magic_prompt.py` | new file, the backend |
| `src/kiro_crew/dashboard/routes/chat.py` | two lines: an import and the route `POST /api/chat/slots/{slot}/magic-prompt` |
| `website/src/components/MagicPromptPopover.tsx` | new file, the panel |
| `website/src/components/ChatInput.tsx` | one `lazy()` line and one small block that mounts the button |
| `website/src/i18n/locales/*.json` | the `components.magicPrompt` strings, translated for all 12 shipped languages |

Every line added to an existing file carries a `kirocrew-magic-plugin` marker. The installer checks that every place it needs exists before it changes anything, and stops with a message if your KiroCrew version has moved on. Running `install` twice is harmless.

## Uninstall

```bash
python install.py uninstall --kirocrew /path/to/KiroCrew --build
```

This removes exactly what was added and leaves the checkout as it was.

## Updating KiroCrew

The plugin edits a few tracked files, so uninstall it before you `git pull` KiroCrew, then install it again afterwards:

```bash
python install.py uninstall --kirocrew /path/to/KiroCrew
git -C /path/to/KiroCrew pull
python install.py install --kirocrew /path/to/KiroCrew --build
```

If a later KiroCrew release changes the files the plugin hooks into, `install` stops with `expected exactly one line ...`. Open an issue and say which KiroCrew version you are on.

## Safety

- The history sent to the model is the same redacted snapshot KiroCrew's Side Chat uses. It keeps the most recent turns, and credentials and exfiltration URLs are stripped.
- Your rough prompt goes through KiroCrew's prompt-injection screen. A flagged prompt is refused. A flagged history is simply left out.
- Each request runs in a throwaway session that is destroyed afterwards, so one chat's history never reaches another request.
- Tool requests from the model are denied and audited. The result has credentials and exfiltration URLs removed before it reaches you.
- The panel shows its own translated error text. It never prints raw server messages.

## Tuning the instructions

The tool's system prompt is the `MAGIC_SYSTEM` string in `magic_prompt.py`. Edit it to change the tone or the rules it follows, then restart KiroCrew.

## Tests

Install with `--with-tests` to copy the plugin's tests into your checkout:

```bash
python install.py install --kirocrew /path/to/KiroCrew --with-tests
cd /path/to/KiroCrew
python -m pytest test/test_magic_prompt.py
cd website && npx vitest run src/test/MagicPromptPopover.test.tsx
```

## License

Apache License 2.0, the same as KiroCrew. See [LICENSE](LICENSE).
