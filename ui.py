"""
Automation Runner UI
A tkinter GUI wrapping automation.py — supports live manual/CAPTCHA input.
"""

import tkinter as tk
from tkinter import ttk, filedialog, scrolledtext
import subprocess
import threading
import sys
from pathlib import Path

SCRIPT_DIR = Path(__file__).parent
AUTOMATION_SCRIPT = SCRIPT_DIR / "automation.py"


def browse_file(var, filetypes):
    path = filedialog.askopenfilename(filetypes=filetypes)
    if path:
        var.set(path)


def main():
    root = tk.Tk()
    root.title("Automation Runner")
    root.geometry("800x700")
    root.resizable(True, True)
    root.configure(bg='#1e1e2e')

    # ── Styles ─────────────────────────────────────────────────────────────────
    style = ttk.Style()
    style.theme_use('clam')
    BG   = '#1e1e2e'
    CARD = '#2a2a3e'
    ACC  = '#89b4fa'
    FG   = '#cdd6f4'
    RED  = '#f38ba8'
    GRN  = '#a6e3a1'
    YLW  = '#f9e2af'
    ORG  = '#fab387'

    style.configure('TFrame',         background=BG)
    style.configure('Card.TFrame',    background=CARD)
    style.configure('TLabel',         background=CARD, foreground=FG, font=('Segoe UI', 9))
    style.configure('Head.TLabel',    background=BG,   foreground=ACC, font=('Segoe UI', 11, 'bold'))
    style.configure('Manual.TFrame',  background='#313244')
    style.configure('Manual.TLabel',  background='#313244', foreground=YLW, font=('Segoe UI', 9, 'bold'))
    style.configure('TEntry',         fieldbackground='#313244', foreground=FG,
                                      insertcolor=FG, borderwidth=0)
    style.configure('TCheckbutton',   background=CARD, foreground=FG, font=('Segoe UI', 9))
    style.map('TCheckbutton',         background=[('active', CARD)])
    style.configure('Run.TButton',    background=ACC,  foreground='#1e1e2e',
                                      font=('Segoe UI', 10, 'bold'), padding=(14, 6))
    style.map('Run.TButton',          background=[('active', '#74c7ec'), ('disabled', '#45475a')])
    style.configure('Stop.TButton',   background=RED,  foreground='#1e1e2e',
                                      font=('Segoe UI', 10, 'bold'), padding=(14, 6))
    style.map('Stop.TButton',         background=[('active', '#eba0ac'), ('disabled', '#45475a')])
    style.configure('Submit.TButton', background=ORG,  foreground='#1e1e2e',
                                      font=('Segoe UI', 9, 'bold'), padding=(10, 4))
    style.map('Submit.TButton',       background=[('active', '#fe9057')])
    style.configure('Browse.TButton', background='#45475a', foreground=FG,
                                      font=('Segoe UI', 8), padding=(6, 3))
    style.map('Browse.TButton',       background=[('active', '#585b70')])

    # ── Shared state ───────────────────────────────────────────────────────────
    state        = {'proc': None, 'stopped': False}
    input_event  = threading.Event()
    input_holder = ['']   # [0] receives the value the user typed

    # ── Header ─────────────────────────────────────────────────────────────────
    hdr = ttk.Frame(root, style='TFrame', padding=(20, 12, 20, 4))
    hdr.pack(fill='x')
    ttk.Label(hdr, text="⚙  Automation Runner", style='Head.TLabel').pack(side='left')

    # ── Settings card ──────────────────────────────────────────────────────────
    card = ttk.Frame(root, style='Card.TFrame', padding=18)
    card.pack(fill='x', padx=20, pady=(0, 8))
    card.columnconfigure(1, weight=1)

    var_recipe = tk.StringVar()
    var_excel  = tk.StringVar()

    def file_row(r, label, var, types):
        ttk.Label(card, text=label, style='TLabel').grid(
            row=r, column=0, sticky='w', padx=(0, 10))
        ttk.Entry(card, textvariable=var, width=52).grid(row=r, column=1, sticky='ew')
        ttk.Button(card, text='Browse…', style='Browse.TButton',
                   command=lambda: browse_file(var, types)).grid(
            row=r, column=2, padx=(8, 0))

    file_row(0, 'Recipe JSON', var_recipe,
             [('JSON files', '*.json'), ('All files', '*.*')])
    file_row(1, 'Excel file',  var_excel,
             [('Excel files', '*.xlsx *.xls'), ('All files', '*.*')])

    ttk.Separator(card, orient='horizontal').grid(
        row=2, column=0, columnspan=3, sticky='ew', pady=8)

    opts = ttk.Frame(card, style='Card.TFrame')
    opts.grid(row=3, column=0, columnspan=3, sticky='ew')

    var_sheet       = tk.StringVar(value='0')
    var_count       = tk.StringVar()
    var_delay       = tk.StringVar(value='0.4')
    var_start_stage = tk.StringVar()

    def opt_field(c, label, var, width=8):
        ttk.Label(opts, text=label, style='TLabel').grid(
            row=0, column=c, sticky='w', padx=(0 if c == 0 else 16, 4))
        ttk.Entry(opts, textvariable=var, width=width).grid(row=0, column=c + 1, sticky='w')

    opt_field(0, 'Sheet',       var_sheet, 8)
    opt_field(2, 'Count',       var_count, 6)
    opt_field(4, 'Delay (sec)', var_delay, 6)
    opt_field(6, 'Start stage', var_start_stage, 4)

    chk_row = ttk.Frame(card, style='Card.TFrame')
    chk_row.grid(row=4, column=0, columnspan=3, sticky='w', pady=(10, 0))

    var_headless      = tk.BooleanVar()
    var_keep_open     = tk.BooleanVar()
    var_fresh_session = tk.BooleanVar()

    ttk.Checkbutton(chk_row, text='Headless',      variable=var_headless,
                    style='TCheckbutton').pack(side='left', padx=(0, 16))
    ttk.Checkbutton(chk_row, text='Keep open',     variable=var_keep_open,
                    style='TCheckbutton').pack(side='left', padx=(0, 16))
    ttk.Checkbutton(chk_row, text='Fresh session', variable=var_fresh_session,
                    style='TCheckbutton').pack(side='left')

    # ── Run / Stop buttons ─────────────────────────────────────────────────────
    btn_row = ttk.Frame(root, style='TFrame')
    btn_row.pack(fill='x', padx=20, pady=(0, 4))

    btn_run  = ttk.Button(btn_row, text='▶  Run',  style='Run.TButton')
    btn_stop = ttk.Button(btn_row, text='⏹  Stop', style='Stop.TButton', state='disabled')
    btn_run.pack(side='left', padx=(0, 8))
    btn_stop.pack(side='left')

    # ── Manual input panel (hidden until needed) ───────────────────────────────
    manual_frame = ttk.Frame(root, style='Manual.TFrame', padding=(12, 8))
    # NOT packed yet — shown dynamically when automation needs input

    manual_icon  = tk.Label(manual_frame, text="⏸", bg='#313244', fg=YLW,
                             font=('Segoe UI', 12))
    manual_icon.pack(side='left', padx=(0, 6))

    manual_lbl = ttk.Label(manual_frame, text="Manual input required",
                            style='Manual.TLabel')
    manual_lbl.pack(side='left', padx=(0, 12))

    manual_entry = ttk.Entry(manual_frame, width=32, font=('Consolas', 10))
    manual_entry.pack(side='left', padx=(0, 8))

    def submit_manual(event=None):
        """Called when user presses Enter or clicks Submit."""
        input_holder[0] = manual_entry.get()
        manual_entry.delete(0, tk.END)
        manual_frame.pack_forget()
        input_event.set()

    manual_entry.bind('<Return>', submit_manual)
    ttk.Button(manual_frame, text='Submit ↩', style='Submit.TButton',
               command=submit_manual).pack(side='left')

    # ── Log output area ────────────────────────────────────────────────────────
    log_widget = scrolledtext.ScrolledText(
        root, bg='#11111b', fg=FG, insertbackground=FG,
        font=('Consolas', 9), relief='flat', wrap='none', state='disabled'
    )
    log_widget.tag_config('cmd',  foreground=ACC)
    log_widget.tag_config('ok',   foreground=GRN)
    log_widget.tag_config('warn', foreground=YLW)
    log_widget.tag_config('err',  foreground=RED)
    log_widget.tag_config('sent', foreground=ORG)
    log_widget.pack(fill='both', expand=True, padx=20, pady=(0, 16))

    # ── Helpers ────────────────────────────────────────────────────────────────

    def append(text, tag=''):
        """Thread-safe log append via after(0)."""
        def _do():
            log_widget.insert(tk.END, text, tag)
            log_widget.see(tk.END)
        log_widget.after(0, _do)

    def show_manual_panel(label_text):
        """Show the manual input panel (must run on main thread)."""
        manual_lbl.config(text=f"MANUAL INPUT — {label_text}")
        manual_frame.pack(fill='x', padx=20, pady=(0, 4), before=log_widget)
        manual_entry.focus_set()

    # ── Background automation thread ───────────────────────────────────────────

    def run_thread(recipe, excel, sheet, count, delay,
                   headless, keep_open, fresh_session, start_stage):

        # -u = unbuffered stdout so every print() reaches us immediately
        cmd = [sys.executable, '-u', str(AUTOMATION_SCRIPT), '--recipe', recipe]
        if excel:         cmd += ['--excel', excel]
        if sheet:         cmd += ['--sheet', sheet]
        if count:         cmd += ['--count', count]
        if delay:         cmd += ['--delay', delay]
        if headless:      cmd.append('--headless')
        if keep_open:     cmd.append('--keep-open')
        if fresh_session: cmd.append('--fresh-session')
        if start_stage:   cmd += ['--start-stage', start_stage]

        log_widget.after(0, lambda: log_widget.config(state='normal'))
        log_widget.after(0, lambda: log_widget.delete('1.0', tk.END))
        append(f"▶ {' '.join(cmd)}\n{'─'*60}\n", 'cmd')

        try:
            proc = subprocess.Popen(
                cmd,
                stdin=subprocess.PIPE,       # we can write answers back
                stdout=subprocess.PIPE,
                stderr=subprocess.STDOUT,
                text=True,
                encoding='utf-8',
                errors='replace',
                cwd=str(SCRIPT_DIR),
            )
            state['proc'] = proc
            log_widget.after(0, lambda: btn_stop.config(state='normal'))
            log_widget.after(0, lambda: btn_run.config(state='disabled'))

            # ── Stream output one character at a time ──────────────────────────
            # This is necessary because the input() prompt has no trailing \n
            # and would never arrive through a line-buffered reader.
            buf             = ''
            awaiting_manual = False
            manual_label_text = ''

            while True:
                ch = proc.stdout.read(1)
                if not ch:
                    break

                if ch == '\n':
                    line = buf + '\n'
                    buf  = ''

                    # Detect the MANUAL INPUT announcement line
                    if '⏸  MANUAL INPUT' in line:
                        awaiting_manual = True
                        parts = line.split('—', 1)
                        manual_label_text = parts[1].strip() if len(parts) > 1 else 'value'
                        append(line, 'warn')
                    else:
                        append(line)
                else:
                    buf += ch
                    # The input() prompt "👉 Read it from the browser …" never
                    # gets a \n because Python is waiting for stdin right after.
                    # Detect it by the emoji and trigger UI input.
                    if awaiting_manual and '👉' in buf:
                        append(buf + '\n', 'warn')
                        buf = ''
                        awaiting_manual = False

                        # Ask the user via the GUI panel and WAIT here
                        input_event.clear()
                        lbl = manual_label_text  # capture for lambda
                        log_widget.after(0, lambda l=lbl: show_manual_panel(l))
                        input_event.wait()       # blocks this thread, not the UI

                        # Send the answer to the subprocess
                        answer = input_holder[0] + '\n'
                        proc.stdin.write(answer)
                        proc.stdin.flush()
                        append(f"  ✏ Sent: {input_holder[0]!r}\n", 'sent')

            # flush any remaining partial line
            if buf:
                append(buf)

            proc.wait()
            rc = proc.returncode
            append(f"\n{'─'*60}\n")
            if rc == 0:
                append("✅ Finished successfully.\n", 'ok')
            elif state.get('stopped'):
                append("⛔ Stopped by user.\n", 'warn')
            else:
                append(f"❌ Exited with code {rc}.\n", 'err')

        except Exception as e:
            append(f"\n❌ Error: {e}\n", 'err')
        finally:
            state['proc']    = None
            state['stopped'] = False
            log_widget.after(0, lambda: btn_run.config(state='normal'))
            log_widget.after(0, lambda: btn_stop.config(state='disabled'))
            log_widget.after(0, lambda: log_widget.config(state='disabled'))
            log_widget.after(0, manual_frame.pack_forget)
            # Unblock the wait in case the process died mid-prompt
            input_event.set()

    # ── Button callbacks ───────────────────────────────────────────────────────

    def on_run():
        recipe = var_recipe.get().strip()
        if not recipe:
            log_widget.config(state='normal')
            log_widget.delete('1.0', tk.END)
            log_widget.insert(tk.END, "⚠ Please select a Recipe JSON file.\n", 'warn')
            log_widget.config(state='disabled')
            return
        threading.Thread(
            target=run_thread,
            args=(
                recipe,
                var_excel.get().strip() or None,
                var_sheet.get().strip() or None,
                var_count.get().strip() or None,
                var_delay.get().strip() or None,
                var_headless.get(),
                var_keep_open.get(),
                var_fresh_session.get(),
                var_start_stage.get().strip() or None,
            ),
            daemon=True,
        ).start()

    def on_stop():
        proc = state.get('proc')
        if proc and proc.poll() is None:
            state['stopped'] = True
            proc.terminate()
            btn_stop.config(state='disabled')

    btn_run.config(command=on_run)
    btn_stop.config(command=on_stop)

    # auto-fill recipe if it sits next to ui.py
    default_recipe = SCRIPT_DIR / 'automation_recipe.json'
    if default_recipe.exists():
        var_recipe.set(str(default_recipe))

    root.mainloop()


if __name__ == '__main__':
    main()
