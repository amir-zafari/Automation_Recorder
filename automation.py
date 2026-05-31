"""
Web Automation Runner
Usage:
    python automation.py --recipe recipe.json --excel data.xlsx
    python automation.py --recipe recipe.json --count 5
    python automation.py --recipe recipe.json --excel data.xlsx --count 3 --headless

Highlights:
  * One browser window is reused for every run (no re-login each row).
  * Cookies + localStorage + sessionStorage from the recording are restored,
    so a logged-in session is recreated.
  * CAPTCHA / manual fields pause and ask you to type the value in the terminal
    (read it from the open browser window).
  * Clicks are resilient: JS-ancestor fallback + waits for late-rendered pages.
"""

import json
import time
import argparse
import sys
from pathlib import Path
from urllib.parse import urlsplit

# Force UTF-8 console output so Persian text + emoji never crash on a Windows
# code page (cp1252). 'replace' degrades gracefully instead of raising.
for _stream in (sys.stdout, sys.stderr):
    try:
        _stream.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

try:
    import pandas as pd
except ImportError:
    print("ERROR: pandas not installed. Run: pip install pandas openpyxl")
    sys.exit(1)

try:
    from selenium import webdriver
    from selenium.webdriver.common.by import By
    from selenium.webdriver.common.keys import Keys
    from selenium.webdriver.common.action_chains import ActionChains
    from selenium.webdriver.support.ui import WebDriverWait
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.chrome.options import Options
    from selenium.common.exceptions import (
        TimeoutException, NoSuchElementException, WebDriverException,
    )
except ImportError:
    print("ERROR: selenium not installed. Run: pip install selenium")
    sys.exit(1)

# ─── Key mapping ─────────────────────────────────────────────────────────────
KEY_MAP = {
    'Enter':     Keys.ENTER,
    'Return':    Keys.RETURN,
    'Tab':       Keys.TAB,
    'Escape':    Keys.ESCAPE,
    'Space':     Keys.SPACE,
    'Backspace': Keys.BACKSPACE,
    'Delete':    Keys.DELETE,
    'ArrowDown': Keys.ARROW_DOWN,
    'ArrowUp':   Keys.ARROW_UP,
    'ArrowLeft': Keys.ARROW_LEFT,
    'ArrowRight':Keys.ARROW_RIGHT,
    'Home':      Keys.HOME,
    'End':       Keys.END,
    'F1':  Keys.F1,  'F2': Keys.F2,  'F5': Keys.F5,
}

# Value tokens that mean "ask the human at runtime" (e.g. a CAPTCHA).
ASK_TOKENS = ('{ASK}', '{MANUAL}', '{?}')

# Substrings that suggest a field is a CAPTCHA / human-verification field.
CAPTCHA_HINTS = (
    'captcha', 'کد امنیتی', 'کد تصویر', 'security code', 'verification',
    'verify code', 'کد تایید', 'کد تأیید', 'robot',
)

# ─── Helpers ──────────────────────────────────────────────────────────────────

def load_recipe(path: str) -> dict:
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def load_excel(path: str, sheet=0):
    df = pd.read_excel(path, sheet_name=sheet)
    return df.to_dict('records'), list(df.columns)


def build_variables(row: dict, columns: list) -> dict:
    """Map {1}, {2}... to column values based on column order."""
    variables = {}
    for i, col in enumerate(columns):
        variables[f'{{{i + 1}}}'] = str(row.get(col, ''))
    return variables


def replace_vars(text: str, variables: dict) -> str:
    if not text:
        return text
    for var, val in variables.items():
        text = text.replace(var, val)
    return text


def wants_manual(value: str) -> bool:
    return bool(value) and any(tok in value for tok in ASK_TOKENS)


def is_captcha_action(action: dict) -> bool:
    """Heuristic: does this action target a CAPTCHA-like field?"""
    if action.get('captcha') is True or action.get('manual') is True:
        return True
    blob = ' '.join(str(action.get(k, '')) for k in ('xpath', 'description', 'id', 'name')).lower()
    return any(h in blob for h in CAPTCHA_HINTS)


def make_driver(headless: bool) -> webdriver.Chrome:
    opts = Options()
    if headless:
        opts.add_argument('--headless=new')
    opts.add_argument('--window-size=1280,900')
    opts.add_argument('--no-sandbox')
    opts.add_argument('--disable-dev-shm-usage')
    opts.add_argument('--disable-blink-features=AutomationControlled')
    opts.add_experimental_option('excludeSwitches', ['enable-automation'])
    # Keep the window open after the script ends (we close it ourselves).
    opts.add_experimental_option('detach', True)
    return webdriver.Chrome(options=opts)


def wait_page_ready(driver, timeout: int = 20):
    try:
        WebDriverWait(driver, timeout).until(
            lambda d: d.execute_script('return document.readyState') == 'complete'
        )
    except TimeoutException:
        pass  # SPAs may never report 'complete'; carry on.


def origin_of(url: str) -> str:
    p = urlsplit(url)
    return f'{p.scheme}://{p.netloc}'


# ─── Session restore (cookies + storage) ─────────────────────────────────────

def set_cookies(driver, cookies: list, url: str):
    driver.get(url)
    wait_page_ready(driver)
    time.sleep(1)
    for cookie in cookies:
        clean = {}
        for key in ('name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'expiry'):
            if key in cookie and cookie[key] is not None:
                clean[key] = cookie[key]
        if 'httpOnly' in clean:
            clean['httpOnly'] = bool(clean['httpOnly'])
        # A leading-dot domain mismatch is the usual cause of add_cookie errors;
        # drop the domain and let Selenium attach it to the current host.
        try:
            driver.add_cookie(clean)
        except Exception:
            clean.pop('domain', None)
            try:
                driver.add_cookie(clean)
            except Exception as e:
                print(f"    ⚠ Cookie '{cookie.get('name')}' skipped: {e}")


def set_storage(driver, storage_entries: list):
    """Restore localStorage / sessionStorage for each captured origin."""
    for entry in storage_entries:
        origin = entry.get('origin')
        if not origin:
            continue
        try:
            if origin_of(driver.current_url) != origin:
                driver.get(origin)
                wait_page_ready(driver)
        except WebDriverException:
            driver.get(origin)
            wait_page_ready(driver)
        for store, key in (('local', 'localStorage'), ('session', 'sessionStorage')):
            for k, v in (entry.get(store) or {}).items():
                try:
                    driver.execute_script(
                        f"window.{key}.setItem(arguments[0], arguments[1]);", k, v
                    )
                except WebDriverException as e:
                    print(f"    ⚠ {key} '{k}' skipped: {e}")


def apply_session(driver, recipe: dict, start_stage: int = -1):
    """Recreate the logged-in session once, before any run.

    If start_stage >= 0, use that stage's cookies/storage/url so the runner
    can skip straight to (e.g.) the logged-in page without replaying login.
    """
    stages = recipe.get('stages', []) or []

    # Resolve which source to use: a specific stage, or the top-level snapshot.
    if start_stage >= 0 and start_stage < len(stages):
        stage = stages[start_stage]
        url     = stage.get('url', '') or recipe.get('url', '')
        cookies = stage.get('cookies', []) or []
        storage = stage.get('storage', []) or []
        print(f"  ⏭  Starting from stage {start_stage}: {stage.get('name', url)}")
    else:
        url     = recipe.get('url', '')
        cookies = recipe.get('cookies', []) or []
        storage = recipe.get('storage', []) or []

    if not url and storage:
        url = storage[0].get('origin', '')

    if cookies:
        print(f"  🍪 Restoring {len(cookies)} cookie(s)")
        set_cookies(driver, cookies, url)
    elif url:
        print(f"  🌐 Opening {url}")
        driver.get(url)
        wait_page_ready(driver)

    if storage:
        n = sum(len(e.get('local') or {}) + len(e.get('session') or {}) for e in storage)
        print(f"  💾 Restoring {n} storage item(s)")
        set_storage(driver, storage)

    if url:
        driver.get(url)            # reload so the app picks up cookies + tokens
        wait_page_ready(driver)
    time.sleep(1)


# ─── Element interaction ─────────────────────────────────────────────────────

def find_el(driver, xpath: str, timeout: int = 15):
    return WebDriverWait(driver, timeout).until(
        EC.presence_of_element_located((By.XPATH, xpath))
    )


def robust_click(driver, el):
    """Click reliably: scroll into view, normal click, then JS-ancestor fallback."""
    driver.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
    time.sleep(0.2)
    try:
        el.click()
        return
    except WebDriverException:
        pass
    # Fallback: click the nearest real clickable ancestor (button/a) via JS —
    # this rescues recordings that targeted an <svg>/icon inside a button.
    driver.execute_script(
        "var t=arguments[0];"
        "var c=t.closest('button,a,[role=button],input[type=submit],input[type=button]');"
        "(c||t).click();", el
    )


def type_into_element(driver, el, value: str, is_contenteditable: bool = False):
    """Type into a normal input OR a contenteditable (ChatGPT/Gmail/Notion)."""
    ce = el.get_attribute('contenteditable')
    if is_contenteditable or ce in ('true', ''):
        el.click()
        time.sleep(0.2)
        el.send_keys(Keys.CONTROL, 'a')
        time.sleep(0.1)
        el.send_keys(Keys.DELETE)
        time.sleep(0.1)
        el.send_keys(value)
    else:
        try:
            el.clear()
        except WebDriverException:
            pass
        el.send_keys(value)


def prompt_manual(label: str, headless: bool) -> str:
    """Ask the human to type a value (e.g. CAPTCHA) read from the browser."""
    if headless:
        print("    ⚠ Manual/CAPTCHA field needs a visible browser — run WITHOUT --headless.")
    print(f"    ⏸  MANUAL INPUT — {label}")
    try:
        return input("       👉 Read it from the browser and type it here, then Enter: ").strip()
    except EOFError:
        return ''


# ─── Actions ─────────────────────────────────────────────────────────────────

def _eval_condition(left: str, operator: str, right: str) -> bool:
    """Evaluate a condition between two string values."""
    try:
        if operator == '==':           return left == right
        if operator == '!=':           return left != right
        if operator == 'contains':     return right in left
        if operator == 'not_contains': return right not in left
        if operator == 'starts_with':  return left.startswith(right)
        if operator == 'ends_with':    return left.endswith(right)
        # Numeric comparisons — fall back to string compare on ValueError
        lf, rf = float(left), float(right)
        if operator == '>':  return lf >  rf
        if operator == '<':  return lf <  rf
        if operator == '>=': return lf >= rf
        if operator == '<=': return lf <= rf
    except (ValueError, TypeError):
        # If numeric conversion fails, treat > / < / >= / <= as string compare
        if operator == '>':  return left >  right
        if operator == '<':  return left <  right
        if operator == '>=': return left >= right
        if operator == '<=': return left <= right
    return False


def execute_action(driver, action: dict, variables: dict, delay: float, headless: bool):
    atype = action.get('type', '')
    desc  = action.get('description', '')

    if atype == 'navigate':
        url = replace_vars(action.get('url', ''), variables)
        print(f"    → navigate: {url}")
        driver.get(url)
        wait_page_ready(driver)
        time.sleep(delay * 2)

    elif atype == 'manual':
        xpath = action.get('xpath')
        value = prompt_manual(desc or 'value', headless)
        if xpath and value:
            el = find_el(driver, xpath)
            driver.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
            type_into_element(driver, el, value, action.get('isContentEditable', False))
        time.sleep(delay)

    elif atype == 'click':
        xpath = action['xpath']
        value = replace_vars(action.get('value', ''), variables)
        print(f"    → click: {desc or xpath[:50]}" + (f" + type" if value else ''))
        el = find_el(driver, xpath)
        robust_click(driver, el)
        time.sleep(0.3)
        if value:  # ChatGPT-style: click then type into the same element
            if wants_manual(value):
                value = prompt_manual(desc or 'value', headless)
            type_into_element(driver, el, value, action.get('isContentEditable', False))
        time.sleep(delay)

    elif atype == 'input':
        xpath = action['xpath']
        value = replace_vars(action.get('value', ''), variables)
        # CAPTCHA / manual fields: never replay a stale value — ask the human.
        if wants_manual(value) or is_captcha_action(action):
            value = prompt_manual(desc or xpath[:40], headless)
        else:
            print(f"    → input: {desc or xpath[:40]} = '{value}'")
        if value == '':
            time.sleep(delay)
            return
        el = find_el(driver, xpath)
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
        type_into_element(driver, el, value, action.get('isContentEditable', False))
        time.sleep(delay)

    elif atype == 'keyboard':
        key_name = action.get('key', 'Return')
        key = KEY_MAP.get(key_name, key_name)
        xpath = action.get('xpath')
        print(f"    → keyboard: {key_name}")
        if xpath:
            try:
                find_el(driver, xpath, timeout=5).send_keys(key)
            except TimeoutException:
                ActionChains(driver).send_keys(key).perform()
        else:
            ActionChains(driver).send_keys(key).perform()
        time.sleep(delay)

    elif atype == 'wait':
        secs = action.get('seconds', 1)
        print(f"    → wait: {secs}s")
        time.sleep(secs)

    elif atype == 'view':
        # Read text from an element and store it in the variables dict.
        xpath    = action.get('xpath', '')
        variable = action.get('variable', '')
        if not xpath:
            print(f"    ⚠ view: no xpath specified")
        elif not variable:
            print(f"    ⚠ view: no variable name specified")
        else:
            try:
                el    = find_el(driver, xpath, timeout=10)
                value = (el.text or el.get_attribute('value') or
                         el.get_attribute('innerText') or '').strip()
                variables[variable] = value
                print(f"    → view: {variable} = {value!r}")
            except TimeoutException:
                print(f"    ⚠ view: element not found — {xpath}")
                variables[variable] = ''

    elif atype == 'condition':
        left_raw  = action.get('left',  '')
        operator  = action.get('operator', '==')
        right_raw = action.get('right', '')

        left  = replace_vars(left_raw,  variables)
        right = replace_vars(right_raw, variables)

        result = _eval_condition(left, operator, right)
        branch = 'then' if result else 'else'
        mark   = '✓ then' if result else '✗ else'
        print(f"    → condition: {left!r} {operator} {right!r}  →  {mark}")

        sub_actions = action.get(branch) or []
        if sub_actions:
            _exec_action_list(driver, sub_actions, variables, delay, headless)
        else:
            print(f"      (branch '{branch}' is empty — nothing to do)")

    else:
        print(f"    ⚠ Unknown action type: {atype}")


def _exec_action_list(driver, actions: list, variables: dict, delay: float, headless: bool):
    """Execute a flat list of actions (used for main list and condition branches)."""
    for action in actions:
        try:
            execute_action(driver, action, variables, delay, headless)
        except TimeoutException:
            print(f"    ❌ Timeout on step {action.get('step', '?')} "
                  f"({action.get('type')}): element not found — {action.get('xpath', '')}")
        except NoSuchElementException:
            print(f"    ❌ Element not found on step {action.get('step', '?')}: "
                  f"{action.get('xpath', '')}")


def run_actions(driver, recipe: dict, variables: dict, delay: float, headless: bool):
    _exec_action_list(driver, recipe.get('actions', []), variables, delay, headless)
    print("  ✓ Run complete")


# ─── Main ─────────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description='Selenium Web Automation Runner',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
Examples:
  python automation.py --recipe recipe.json --excel data.xlsx
  python automation.py --recipe recipe.json --excel data.xlsx --count 5
  python automation.py --recipe recipe.json --count 3
  python automation.py --recipe recipe.json --excel data.xlsx --headless --delay 0.5
        """
    )
    parser.add_argument('--recipe',   required=True,       help='Path to automation_recipe.json')
    parser.add_argument('--excel',                         help='Path to Excel file with variables (.xlsx)')
    parser.add_argument('--sheet',    default=0,           help='Sheet name or index (default: 0)')
    parser.add_argument('--count',    type=int,            help='Max number of runs (default: all Excel rows or 1)')
    parser.add_argument('--headless', action='store_true', help='Run browser in headless mode (no window)')
    parser.add_argument('--delay',    type=float, default=0.4, help='Delay between actions in seconds (default: 0.4)')
    parser.add_argument('--keep-open', action='store_true', help='Leave the browser open after finishing')
    parser.add_argument('--fresh-session', action='store_true',
                        help='Re-apply cookies/storage before every run (default: only once)')
    parser.add_argument('--start-stage', type=int, default=-1,
                        help='Stage index to start from (0-based). Uses that stage\'s cookies/storage/URL instead of the top-level snapshot.')
    args = parser.parse_args()

    recipe_path = Path(args.recipe)
    if not recipe_path.exists():
        print(f"ERROR: Recipe file not found: {args.recipe}")
        sys.exit(1)

    recipe = load_recipe(args.recipe)
    print(f"\n📋 Recipe loaded: {recipe_path.name}")
    print(f"   URL: {recipe.get('url', '—')}")
    print(f"   Actions: {len(recipe.get('actions', []))}")
    print(f"   Variables: {recipe.get('variables', [])}")
    print(f"   Cookies: {len(recipe.get('cookies', []) or [])}")
    print(f"   Storage origins: {len(recipe.get('storage', []) or [])}")
    stages = recipe.get('stages', []) or []
    if stages:
        print(f"   Stages: {len(stages)}")
        for s in stages:
            print(f"     [{s['index']}] {s.get('name', s.get('url', ''))}")

    # Build the list of variable-sets, one per run.
    if args.excel:
        excel_path = Path(args.excel)
        if not excel_path.exists():
            print(f"ERROR: Excel file not found: {args.excel}")
            sys.exit(1)
        rows, columns = load_excel(args.excel, args.sheet)
        print(f"\n📊 Excel loaded: {excel_path.name}")
        print(f"   Rows: {len(rows)} | Columns: {columns}")
        if args.count:
            rows = rows[:args.count]
        run_vars = [build_variables(r, columns) for r in rows]
    else:
        count = args.count or 1
        run_vars = [{} for _ in range(count)]

    if not run_vars:
        print("Nothing to run.")
        return

    print(f"\n🚀 Starting {len(run_vars)} run(s) — single shared browser...\n")

    driver = make_driver(args.headless)
    try:
        # Recreate the logged-in session ONCE, then reuse it for every run.
        apply_session(driver, recipe, args.start_stage)
        stages = recipe.get('stages', []) or []
        if args.start_stage >= 0 and args.start_stage < len(stages):
            loop_url = stages[args.start_stage].get('url', recipe.get('url', ''))
        else:
            loop_url = recipe.get('url', '')

        for i, variables in enumerate(run_vars):
            preview = dict(list(variables.items())[:3]) if variables else '(no variables)'
            print(f"Run {i + 1}/{len(run_vars)}: {preview}")

            if i > 0:
                if args.fresh_session:
                    apply_session(driver, recipe, args.start_stage)
                elif loop_url:
                    driver.get(loop_url)     # back to the start page for the next row
                    wait_page_ready(driver)
                    time.sleep(0.5)

            run_actions(driver, recipe, variables, args.delay, args.headless)
            time.sleep(0.5)

        print("\n✅ All runs finished.")

    except WebDriverException as e:
        print(f"\n❌ WebDriver error: {e}")
    finally:
        if args.keep_open:
            print("\n🪟 Browser left open (--keep-open). Press Enter here to close it...")
            try:
                input()
            except EOFError:
                pass
        driver.quit()


if __name__ == '__main__':
    main()
