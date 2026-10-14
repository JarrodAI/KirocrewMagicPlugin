#!/usr/bin/env python3
"""Install, remove or inspect the Magic Prompt plugin in a KiroCrew source checkout.

    python install.py install   --kirocrew /path/to/KiroCrew [--with-tests] [--build]
    python install.py uninstall --kirocrew /path/to/KiroCrew [--build]
    python install.py status    --kirocrew /path/to/KiroCrew

It adds one backend route, one React component, one mount point in the chat composer
and the translated UI strings. Every line it inserts into an existing file carries a
`kirocrew-magic-plugin` marker, so `uninstall` removes exactly what `install` added.
Running either command twice is safe. Nothing is changed unless every anchor it needs
is found first.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
PLUGIN = HERE / "plugin"
MARK = "kirocrew-magic-plugin"

BACKEND_DST = "src/kiro_crew/dashboard/handlers/magic_prompt.py"
FRONTEND_DST = "website/src/components/MagicPromptPopover.tsx"
ROUTES = "src/kiro_crew/dashboard/routes/chat.py"
COMPOSER = "website/src/components/ChatInput.tsx"
LOCALES = "website/src/i18n/locales"
TEST_DST = {
    "test_magic_prompt.py": "test/test_magic_prompt.py",
    "MagicPromptPopover.test.tsx": "website/src/test/MagicPromptPopover.test.tsx",
}

# Existing lines the plugin inserts next to. A line must match exactly (after strip).
ROUTES_IMPORT_ANCHOR = "from kiro_crew.dashboard.handlers._shared import require_owner_dashboard_request"
ROUTES_IMPORT_LINE = f"from kiro_crew.dashboard.handlers.magic_prompt import handle_magic_prompt  # {MARK}"
ROUTES_ROUTE_ANCHOR = 'app.router.add_post("/api/optimizer/optimize", handlers.handle_optimize)'
ROUTES_ROUTE_LINE = (
    f'    app.router.add_post("/api/chat/slots/{{slot}}/magic-prompt", handle_magic_prompt)  # {MARK}'
)
COMPOSER_LAZY_ANCHOR = "const SessionAutomationPopover = lazy(() => import('./SessionAutomationPopover'))"
COMPOSER_LAZY_LINE = f"const MagicPromptPopover = lazy(() => import('./MagicPromptPopover')) // {MARK}"
COMPOSER_MOUNT_ANCHOR = "{/* Knowledge context chip */}"
COMPOSER_MOUNT = f"""      {{/* {MARK}:begin */}}
      {{promptOptimizer && slotId && !terminal.active && !showGhost && (
        <div className="flex justify-end pb-1">
          <Suspense fallback={{null}}>
            <MagicPromptPopover
              slotId={{slotId}}
              draft={{value}}
              disabled={{disabled || !connected}}
              onUse={{text => {{
                valueFromUserRef.current = true
                onChange(text)
                appendBoundary(text)
                requestAnimationFrame(() => {{
                  const control = composerControl()
                  if (control) control.setSelection(text.length, text.length, {{ focus: true }})
                  else inputRef.current?.focus()
                }})
              }}}}
            />
          </Suspense>
        </div>
      )}}
      {{/* {MARK}:end */}}"""


class PluginError(Exception):
    pass


def eol_of(text: str) -> str:
    return "\r\n" if "\r\n" in text else "\n"


def read(path: Path) -> str:
    with open(path, encoding="utf-8", newline="") as handle:
        return handle.read()


def write(path: Path, text: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with open(path, "w", encoding="utf-8", newline="") as handle:
        handle.write(text)


def find_checkout(arg: str | None) -> Path:
    candidates = [arg, os.environ.get("KIROCREW_SRC")]
    if not any(candidates):
        try:
            import kiro_crew  # type: ignore[import-not-found]

            candidates.append(str(Path(kiro_crew.__file__).resolve().parents[2]))
        except Exception:
            pass
        candidates.append(os.getcwd())
    for raw in candidates:
        if raw and (Path(raw) / ROUTES).is_file() and (Path(raw) / COMPOSER).is_file():
            return Path(raw).resolve()
    raise PluginError(
        "Could not find a KiroCrew source checkout. Pass --kirocrew /path/to/KiroCrew "
        "(the folder that contains src/kiro_crew and website/). A pip-only install has no "
        "website source, so it cannot take this plugin."
    )


# ── text edits ────────────────────────────────────────────────────────────────


def insert_after_line(text: str, anchor: str, new_line: str) -> str:
    eol = eol_of(text)
    lines = text.split(eol)
    hits = [i for i, line in enumerate(lines) if line.strip() == anchor]
    if len(hits) != 1:
        raise PluginError(f"expected exactly one line `{anchor}`, found {len(hits)}")
    lines.insert(hits[0] + 1, new_line)
    return eol.join(lines)


def insert_block_before_line(text: str, anchor: str, block: str) -> str:
    eol = eol_of(text)
    lines = text.split(eol)
    hits = [i for i, line in enumerate(lines) if line.strip() == anchor]
    if len(hits) != 1:
        raise PluginError(f"expected exactly one line `{anchor}`, found {len(hits)}")
    lines[hits[0] : hits[0]] = block.split("\n")
    return eol.join(lines)


def remove_marked(text: str) -> str:
    eol = eol_of(text)
    out: list[str] = []
    skipping = False
    for line in text.split(eol):
        if f"{MARK}:begin" in line:
            skipping = True
            continue
        if skipping:
            if f"{MARK}:end" in line:
                skipping = False
            continue
        if MARK in line:
            continue
        out.append(line)
    return eol.join(out)


def is_installed(text: str) -> bool:
    return MARK in text


# ── translations ──────────────────────────────────────────────────────────────


def locale_files(root: Path) -> list[Path]:
    return sorted(
        p for p in (root / LOCALES).glob("*.json") if p.stem not in ("en-XA", "en.manual")
    )


def edit_locale(path: Path, strings: dict[str, dict[str, str]], add: bool) -> None:
    raw = read(path)
    data = json.loads(raw)
    components = data.get("components")
    if not isinstance(components, dict):
        raise PluginError(f"{path.name}: no `components` section")
    if add:
        components["magicPrompt"] = strings.get(path.stem) or strings["en"]
    else:
        components.pop("magicPrompt", None)
    eol = eol_of(raw)
    out = json.dumps(data, indent=2, ensure_ascii=False).replace("\n", eol)
    if raw.endswith(("\n", "\r\n")):
        out += eol
    write(path, out)


# ── commands ──────────────────────────────────────────────────────────────────


def cmd_status(root: Path) -> None:
    routes, composer = read(root / ROUTES), read(root / COMPOSER)
    rows = [
        ("backend route", (root / BACKEND_DST).is_file() and MARK in routes),
        ("composer button", (root / FRONTEND_DST).is_file() and MARK in composer),
        (
            "translations",
            all('"magicPrompt"' in read(p) for p in locale_files(root)),
        ),
    ]
    for name, ok in rows:
        print(f"{name:16} {'installed' if ok else 'not installed'}")


def cmd_install(root: Path, with_tests: bool, build: bool) -> None:
    routes_p, composer_p = root / ROUTES, root / COMPOSER
    routes, composer = read(routes_p), read(composer_p)
    # Preflight: compute every edit in memory first, so a failure changes nothing.
    new_routes, new_composer = routes, composer
    if not is_installed(new_routes):
        new_routes = insert_after_line(new_routes, ROUTES_IMPORT_ANCHOR, ROUTES_IMPORT_LINE)
        new_routes = insert_after_line(new_routes, ROUTES_ROUTE_ANCHOR, ROUTES_ROUTE_LINE)
    if not is_installed(new_composer):
        new_composer = insert_after_line(new_composer, COMPOSER_LAZY_ANCHOR, COMPOSER_LAZY_LINE)
        new_composer = insert_block_before_line(new_composer, COMPOSER_MOUNT_ANCHOR, COMPOSER_MOUNT)
    for needed in ("Suspense", "appendBoundary", "composerControl", "valueFromUserRef", "inputRef"):
        if needed not in composer:
            raise PluginError(f"ChatInput.tsx has no `{needed}`; this KiroCrew version is not supported")
    strings = json.loads(read(PLUGIN / "i18n" / "magicPrompt.json"))
    files = locale_files(root)
    if not files:
        raise PluginError(f"no locale catalogs under {LOCALES}")
    for path in files:
        try:
            if not isinstance(json.loads(read(path)).get("components"), dict):
                raise ValueError("no components section")
        except ValueError as exc:
            raise PluginError(f"{path.name}: {exc}") from exc

    shutil.copyfile(PLUGIN / "backend" / "magic_prompt.py", root / BACKEND_DST)
    shutil.copyfile(PLUGIN / "frontend" / "MagicPromptPopover.tsx", root / FRONTEND_DST)
    if new_routes != routes:
        write(routes_p, new_routes)
    if new_composer != composer:
        write(composer_p, new_composer)
    for path in files:
        edit_locale(path, strings, add=True)
    if with_tests:
        for src_name, dst in TEST_DST.items():
            shutil.copyfile(PLUGIN / "tests" / src_name, root / dst)
    print("Installed the Magic Prompt plugin.")
    finish(root, build)


def cmd_uninstall(root: Path, build: bool) -> None:
    for rel in (BACKEND_DST, FRONTEND_DST, *TEST_DST.values()):
        (root / rel).unlink(missing_ok=True)
    for rel in (ROUTES, COMPOSER):
        text = read(root / rel)
        if is_installed(text):
            write(root / rel, remove_marked(text))
    for path in locale_files(root):
        edit_locale(path, {}, add=False)
    print("Removed the Magic Prompt plugin.")
    finish(root, build)


def npm(root: Path, *args: str) -> None:
    exe = shutil.which("npm")
    if not exe:
        raise PluginError("npm was not found on PATH; build the web UI yourself (see README)")
    subprocess.run([exe, *args], cwd=root / "website", check=True)


def finish(root: Path, build: bool) -> None:
    if build:
        if not (root / "website" / "node_modules").is_dir():
            npm(root, "ci")
        npm(root, "run", "i18n:pseudo")
        npm(root, "run", "build")
        print("Rebuilt the web UI. Restart KiroCrew to load it.")
    else:
        print(
            "Next: rebuild the web UI (cd website && npm run i18n:pseudo && npm run build), "
            "then restart KiroCrew. Or re-run this command with --build."
        )


def main() -> int:
    parser = argparse.ArgumentParser(description="Magic Prompt plugin for KiroCrew")
    parser.add_argument("command", choices=("install", "uninstall", "status"))
    parser.add_argument("--kirocrew", help="path to a KiroCrew source checkout")
    parser.add_argument("--with-tests", action="store_true", help="also copy the plugin's tests")
    parser.add_argument("--build", action="store_true", help="rebuild the web UI afterwards")
    args = parser.parse_args()
    try:
        root = find_checkout(args.kirocrew)
        print(f"KiroCrew checkout: {root}")
        if args.command == "status":
            cmd_status(root)
        elif args.command == "install":
            cmd_install(root, args.with_tests, args.build)
        else:
            cmd_uninstall(root, args.build)
    except PluginError as exc:
        print(f"error: {exc}", file=sys.stderr)
        return 1
    except subprocess.CalledProcessError as exc:
        print(f"error: `{' '.join(map(str, exc.cmd))}` failed ({exc.returncode})", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
