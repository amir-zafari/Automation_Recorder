"""
Web Automation Runner
Usage:
    python automation.py --recipe recipe.json --excel data.xlsx
    python automation.py --recipe recipe.json --count 5
    python automation.py --recipe recipe.json --excel data.xlsx --count 3 --headless
"""

import json
import time
import argparse
import sys
from pathlib import Path

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
    from selenium.webdriver.support.ui import WebDriverWait, Select
    from selenium.webdriver.support import expected_conditions as EC
    from selenium.webdriver.chrome.options import Options
    from selenium.common.exceptions import TimeoutException, NoSuchElementException, WebDriverException
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

# ─── Helpers ──────────────────────────────────────────────────────────────────

def load_recipe(path: str) -> dict:
    with open(path, 'r', encoding='utf-8') as f:
        return json.load(f)


def load_excel(path: str, sheet=0) -> list[dict]:
    df = pd.read_excel(path, sheet_name=sheet)
    return df.to_dict('records'), list(df.columns)


def build_variables(row: dict, columns: list) -> dict:
    """Map {1}, {2}... to column values based on column order."""
    variables = {}
    for i, col in enumerate(columns):
        variables[f'{{{i + 1}}}'] = str(row.get(col, ''))
    return variables


def replace_vars(text: str, variables: dict) -> str:
    for var, val in variables.items():
        text = text.replace(var, val)
    return text


def make_driver(headless: bool) -> webdriver.Chrome:
    opts = Options()
    if headless:
        opts.add_argument('--headless=new')
        opts.add_argument('--window-size=1280,900')
    opts.add_argument('--no-sandbox')
    opts.add_argument('--disable-dev-shm-usage')
    opts.add_argument('--disable-blink-features=AutomationControlled')
    opts.add_experimental_option('excludeSwitches', ['enable-automation'])
    return webdriver.Chrome(options=opts)


def set_cookies(driver: webdriver.Chrome, cookies: list, url: str):
    """Navigate to URL and inject cookies, then refresh."""
    driver.get(url)
    time.sleep(1.5)

    for cookie in cookies:
        clean = {}
        for key in ('name', 'value', 'domain', 'path', 'secure', 'httpOnly', 'expiry'):
            if key in cookie and cookie[key] is not None:
                clean[key] = cookie[key]
        # Selenium requires 'httpOnly' capitalization
        if 'httpOnly' in clean:
            clean['httpOnly'] = bool(clean['httpOnly'])
        try:
            driver.add_cookie(clean)
        except Exception as e:
            print(f"    ⚠ Cookie '{cookie.get('name')}' skipped: {e}")

    driver.refresh()
    time.sleep(1.5)


def find_el(driver: webdriver.Chrome, xpath: str, timeout: int = 10):
    return WebDriverWait(driver, timeout).until(
        EC.presence_of_element_located((By.XPATH, xpath))
    )


def type_into_element(driver: webdriver.Chrome, el, value: str, is_contenteditable: bool = False):
    """تایپ در فیلد — هم input معمولی هم contenteditable (مثل ChatGPT)."""
    # تشخیص contenteditable از attribute
    ce = el.get_attribute('contenteditable')
    if is_contenteditable or ce in ('true', ''):
        # پاک کردن و تایپ در contenteditable
        el.click()
        time.sleep(0.2)
        el.send_keys(Keys.CONTROL + 'a')
        time.sleep(0.1)
        el.send_keys(Keys.DELETE)
        time.sleep(0.1)
        el.send_keys(value)
    else:
        el.clear()
        el.send_keys(value)


def execute_action(driver: webdriver.Chrome, action: dict, variables: dict, delay: float):
    atype = action.get('type', '')
    desc  = action.get('description', '')

    if atype == 'navigate':
        url = replace_vars(action.get('url', ''), variables)
        print(f"    → navigate: {url}")
        driver.get(url)
        time.sleep(delay * 2)

    elif atype == 'click':
        xpath = action['xpath']
        value_raw = action.get('value', '')
        value = replace_vars(value_raw, variables) if value_raw else ''
        print(f"    → click: {desc or xpath[:50]}" + (f" + type: '{value}'" if value else ''))
        el = find_el(driver, xpath)
        driver.execute_script("arguments[0].scrollIntoView({block:'center'});", el)
        time.sleep(0.2)
        el.click()
        time.sleep(0.3)
        # اگه value داشت، بعد از کلیک تایپ میکنه (مثل ChatGPT textarea)
        if value:
            type_into_element(driver, el, value, action.get('isContentEditable', False))
        time.sleep(delay)

    elif atype == 'input':
        xpath = action['xpath']
        raw_value = action.get('value', '')
        value = replace_vars(raw_value, variables)
        print(f"    → input: {desc or xpath[:40]} = '{value}'")
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
                el = find_el(driver, xpath, timeout=5)
                el.send_keys(key)
            except TimeoutException:
                ActionChains(driver).send_keys(key).perform()
        else:
            ActionChains(driver).send_keys(key).perform()
        time.sleep(delay)

    elif atype == 'wait':
        secs = action.get('seconds', 1)
        print(f"    → wait: {secs}s")
        time.sleep(secs)

    else:
        print(f"    ⚠ Unknown action type: {atype}")


def run_once(recipe: dict, variables: dict, headless: bool, delay: float):
    driver = make_driver(headless)
    try:
        url     = recipe.get('url', '')
        cookies = recipe.get('cookies', [])
        actions = recipe.get('actions', [])

        if cookies:
            print(f"  🍪 Setting {len(cookies)} cookies on {url}")
            set_cookies(driver, cookies, url)
        elif url:
            print(f"  🌐 Navigating to {url}")
            driver.get(url)
            time.sleep(1.5)

        for action in actions:
            execute_action(driver, action, variables, delay)

        print("  ✓ Run complete")
        time.sleep(1)

    except TimeoutException as e:
        print(f"  ❌ Timeout: {e}")
    except NoSuchElementException as e:
        print(f"  ❌ Element not found: {e}")
    except WebDriverException as e:
        print(f"  ❌ WebDriver error: {e}")
    finally:
        driver.quit()


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
    args = parser.parse_args()

    # Validate recipe
    recipe_path = Path(args.recipe)
    if not recipe_path.exists():
        print(f"ERROR: Recipe file not found: {args.recipe}")
        sys.exit(1)

    recipe = load_recipe(args.recipe)
    print(f"\n📋 Recipe loaded: {recipe_path.name}")
    print(f"   URL: {recipe.get('url', '—')}")
    print(f"   Actions: {len(recipe.get('actions', []))}")
    print(f"   Variables: {recipe.get('variables', [])}")
    print(f"   Cookies: {len(recipe.get('cookies', []))}")

    # Excel mode
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

        print(f"\n🚀 Starting {len(rows)} run(s)...\n")

        for i, row in enumerate(rows):
            variables = build_variables(row, columns)
            print(f"Run {i + 1}/{len(rows)}: {dict(list(variables.items())[:3])}")
            run_once(recipe, variables, args.headless, args.delay)
            if i < len(rows) - 1:
                time.sleep(0.5)

    # No Excel - fixed count
    else:
        count = args.count or 1
        print(f"\n🚀 Starting {count} run(s) (no Excel)...\n")
        for i in range(count):
            print(f"Run {i + 1}/{count}:")
            run_once(recipe, {}, args.headless, args.delay)
            if i < count - 1:
                time.sleep(0.5)

    print("\n✅ All runs finished.")


if __name__ == '__main__':
    main()
