# 🤖 Web Automation Recorder

ابزاری برای ضبط تعاملات مرورگر و اجرای خودکار آن‌ها با Selenium — بدون نیاز به دانش برنامه‌نویسی برای ضبط.

---

## ✨ قابلیت‌ها

- **ضبط اکشن‌ها** — کلیک، تایپ، کیبرد را در هر سایتی ضبط کن
- **پشتیبانی از contenteditable** — سایت‌هایی مثل ChatGPT، Gmail، Notion که از فیلد استاندارد استفاده نمی‌کنند
- **متغیرهای پویا** — از `{1}`, `{2}`, ... برای مقادیری که از اکسل می‌آیند استفاده کن
- **دریافت کوکی** — کوکی‌های لاگین را برای اجرای اتوماسیون ذخیره کن
- **حالت هوش مصنوعی** — بگو چه کاری می‌خواهی انجام شود، AI برنامه را می‌نویسد
- **خروجی JSON** — فایل دستور العمل قابل استفاده در Python
- **اجرا با اکسل** — برای هر ردیف اکسل، اتوماسیون را اجرا کن

---

## 📁 ساختار پروژه

```
project/
├── manifest.json     ← تنظیمات افزونه کروم
├── popup.html        ← رابط کاربری (۳ تب)
├── popup.js          ← منطق popup
├── background.js     ← ارتباط با Ollama و مدیریت کوکی
├── content.js        ← ضبط‌کننده اکشن (تزریق به صفحه)
└── automation.py     ← اجراکننده Selenium
```

---

## 🚀 نصب و راه‌اندازی

### بخش ۱ — نصب افزونه کروم

1. مرورگر Chrome را باز کن
2. به آدرس `chrome://extensions` برو
3. گزینه **Developer mode** را در گوشه بالا-راست فعال کن
4. دکمه **Load unpacked** را بزن
5. پوشه پروژه را انتخاب کن

افزونه در نوار ابزار کروم ظاهر می‌شود.

---

### بخش ۲ — نصب وابستگی‌های Python

```bash
pip install selenium pandas openpyxl
```

> **نکته:** اگر ChromeDriver نداشتی، با این دستور نصب کن:
> ```bash
> pip install selenium webdriver-manager
> ```
> سپس در `automation.py` بالای فایل اضافه کن:
> ```python
> from webdriver_manager.chrome import ChromeDriverManager
> from selenium.webdriver.chrome.service import Service
> # در تابع make_driver:
> service = Service(ChromeDriverManager().install())
> return webdriver.Chrome(service=service, options=opts)
> ```

---

### بخش ۳ — نصب Ollama (برای حالت AI)

1. از [ollama.ai](https://ollama.ai) نصب کن
2. مدل مورد نظر را دانلود کن:
   ```bash
   ollama pull aya-expanse:8b
   ```
3. Ollama باید روی `http://localhost:11434` در حال اجرا باشد

> اگر می‌خواهی مدل دیگری استفاده کنی، در `background.js` مقدار `MODEL` را عوض کن.

---

## 📖 راهنمای استفاده

### تب ۱ — ضبط اکشن‌ها

```
۱. افزونه را باز کن
۲. دکمه "دریافت کوکی" را بزن (برای سایت‌هایی که لاگین نیاز دارند)
۳. دکمه "شروع ضبط" را بزن
۴. روی صفحه کار کن — کلیک‌ها و تایپ‌ها ضبط می‌شوند
۵. دکمه "توقف" را بزن
۶. مقادیر را ویرایش کن (متن ثابت یا {1} برای متغیر)
۷. دکمه "خروجی JSON" را بزن
```

**نکات مهم هنگام ضبط:**

| نوع اکشن | چطور ضبط می‌شود |
|-----------|-----------------|
| کلیک روی دکمه/لینک | به محض کلیک ثبت می‌شود |
| تایپ در فیلد | وقتی از فیلد خارج شوی (blur) ثبت می‌شود |
| کیبرد (Enter, Tab, ...) | در همان لحظه ثبت می‌شود |

---

### سیستم متغیرها

در فیلد مقدار هر اکشن می‌توانی بنویسی:

| مقدار | توضیح |
|-------|-------|
| `سلام خوبی؟` | متن ثابت — همیشه همین تایپ می‌شود |
| `{1}` | مقدار ستون اول اکسل |
| `{2}` | مقدار ستون دوم اکسل |
| `سلام {1} عزیز` | ترکیب متن ثابت و متغیر |
| `{1}@gmail.com` | ترکیب با پسوند ثابت |

**مثال اکسل:**

| نام | ایمیل | کد |
|-----|-------|-----|
| علی | ali@gmail.com | 1001 |
| رضا | reza@gmail.com | 1002 |
| مریم | maryam@gmail.com | 1003 |

- ستون اول (نام) = `{1}`
- ستون دوم (ایمیل) = `{2}`
- ستون سوم (کد) = `{3}`

---

### تب ۲ — حالت هوش مصنوعی

```
۱. صفحه‌ای که می‌خواهی اتوماسیون کنی را باز کن
۲. افزونه را باز کن و تب "هوش مصنوعی" را بزن
۳. بنویس چه کاری می‌خواهی انجام شود
۴. دکمه "آنالیز صفحه + تولید برنامه" را بزن
۵. AI برنامه را می‌نویسد و نمایش می‌دهد
۶. دکمه "خروجی JSON" را بزن
```

**مثال درخواست:**
> "روی فیلد نام کاربری کلیک کن، {1} را تایپ کن، روی فیلد رمز عبور کلیک کن، {2} را تایپ کن، دکمه ورود را بزن"

---

### تب ۳ — چت

چت ساده با مدل Ollama برای سوال و جواب.

---

## ⚙️ فرمت فایل JSON خروجی

```json
{
  "version": "1.0",
  "generated_at": "2026-05-30T10:00:00.000Z",
  "url": "https://example.com/login",
  "cookies": [
    {
      "name": "session_id",
      "value": "abc123...",
      "domain": "example.com",
      "path": "/",
      "secure": true
    }
  ],
  "actions": [
    {
      "step": 1,
      "type": "click",
      "xpath": "//*[@id=\"username\"]",
      "value": "{1}",
      "description": "فیلد نام کاربری"
    },
    {
      "step": 2,
      "type": "input",
      "xpath": "//input[@name=\"password\"]",
      "value": "{2}",
      "description": "رمز عبور"
    },
    {
      "step": 3,
      "type": "keyboard",
      "xpath": "//input[@name=\"password\"]",
      "key": "Return",
      "description": "ارسال فرم"
    },
    {
      "step": 4,
      "type": "wait",
      "seconds": 2,
      "description": "صبر برای بارگذاری"
    }
  ],
  "variables": ["{1}", "{2}"]
}
```

### انواع اکشن

| نوع | فیلدهای اجباری | توضیح |
|-----|----------------|-------|
| `click` | `xpath` | کلیک روی المان — اگر `value` داشت بعد از کلیک تایپ می‌کند |
| `input` | `xpath`, `value` | تایپ در فیلد (input, textarea, contenteditable) |
| `keyboard` | `key` | فشردن کلید (`Return`, `Tab`, `Escape`, `ArrowDown`, ...) |
| `navigate` | `url` | رفتن به آدرس جدید |
| `wait` | `seconds` | صبر کردن |

---

## 🐍 اجرای Python

### دستورات اجرا

```bash
# اجرا با اکسل — برای هر ردیف یک بار اجرا می‌شود
python automation.py --recipe automation_recipe.json --excel data.xlsx

# اجرا با اکسل، فقط ۵ ردیف اول
python automation.py --recipe automation_recipe.json --excel data.xlsx --count 5

# اجرا بدون اکسل، ۳ بار
python automation.py --recipe automation_recipe.json --count 3

# اجرا بدون پنجره (headless)
python automation.py --recipe automation_recipe.json --excel data.xlsx --headless

# تنظیم تاخیر بین اکشن‌ها (پیش‌فرض: 0.4 ثانیه)
python automation.py --recipe automation_recipe.json --excel data.xlsx --delay 1.0

# شیت خاصی از اکسل
python automation.py --recipe automation_recipe.json --excel data.xlsx --sheet "Sheet2"
```

### آرگومان‌های دستور

| آرگومان | اجباری | پیش‌فرض | توضیح |
|---------|--------|---------|-------|
| `--recipe` | ✅ | — | مسیر فایل JSON |
| `--excel` | ❌ | — | مسیر فایل اکسل |
| `--count` | ❌ | همه ردیف‌ها | تعداد اجرا |
| `--sheet` | ❌ | `0` | نام یا ایندکس شیت |
| `--headless` | ❌ | `false` | اجرا بدون پنجره مرورگر |
| `--delay` | ❌ | `0.4` | تاخیر بین اکشن‌ها (ثانیه) |

---

## 💡 مثال کامل — اتوماسیون ارسال پیام در ChatGPT

### مرحله ۱: ضبط

1. به `chatgpt.com` برو و لاگین کن
2. افزونه را باز کن، کوکی بگیر
3. ضبط را شروع کن
4. روی فیلد ورودی ChatGPT کلیک کن
5. توقف ضبط
6. کنار اکشن کلیک، مقدار `سلام {1} عزیز، {2}` را بنویس
7. خروجی JSON بگیر

### مرحله ۲: آماده‌سازی اکسل

فایل `data.xlsx`:

| نام | متن |
|-----|-----|
| علی | چطوری؟ |
| رضا | امروز چه خبر؟ |

### مرحله ۳: اجرا

```bash
python automation.py --recipe automation_recipe.json --excel data.xlsx
```

خروجی:
```
📋 Recipe loaded: automation_recipe.json
   URL: https://chatgpt.com/...
   Actions: 3
   Variables: ['{1}', '{2}']
   Cookies: 12

📊 Excel loaded: data.xlsx
   Rows: 2 | Columns: ['نام', 'متن']

🚀 Starting 2 run(s)...

Run 1/2: {'{1}': 'علی', '{2}': 'چطوری؟'}
  🍪 Setting 12 cookies on https://chatgpt.com/...
  ✓ Run complete

Run 2/2: {'{1}': 'رضا', '{2}': 'امروز چه خبر؟'}
  🍪 Setting 12 cookies on https://chatgpt.com/...
  ✓ Run complete

✅ All runs finished.
```

---

## ⚠️ نکات مهم

### درباره کوکی‌ها

- کوکی‌های لاگین معمولاً **۷ تا ۳۰ روز** اعتبار دارند
- هر بار که session منقضی شد، دوباره از افزونه کوکی بگیر
- برخی سایت‌ها از **CSRF token** استفاده می‌کنند — اگر اتوماسیون کار نکرد، سعی کن ابتدا با کوکی‌ها صفحه لاگین را باز کنی

### درباره XPath

- بهترین XPath آن‌هایی هستند که از `id` یا `name` استفاده می‌کنند: `//*[@id="submit"]`
- اگر سایت بعد از لاگین ساختار HTML را تغییر دهد، XPath ممکن است کار نکند
- در صورت خطا، می‌توانی XPath را دستی در فایل JSON ویرایش کنی

### درباره contenteditable

سایت‌هایی که از `contenteditable` استفاده می‌کنند (مثل ChatGPT، Gmail، Notion):
- ضبط خودکار کار می‌کند اما فقط **بعد از اینکه از فیلد خارج شوی**
- اگر ضبط نشد، از فیلد **کنار** کلیک کن تا blur اتفاق بیفتد
- در JSON مقدار `"isContentEditable": true` به اکشن اضافه کن

### محدودیت‌های امنیتی

برخی سایت‌ها ابزارهای اتوماسیون را تشخیص می‌دهند. در این صورت:
```python
# در make_driver، این آپشن را اضافه کن:
opts.add_argument('--user-agent=Mozilla/5.0 (Windows NT 10.0; Win64; x64) ...')
```

---

## 🐛 رفع مشکلات رایج

### ❌ `خطا: نتوانستم صفحه را بخوانم`

افزونه را روی صفحه مجاز نیست. برو به `chrome://extensions` ← افزونه ← **Allow on all sites**.

---

### ❌ `TimeoutException: element not found`

- XPath اشتباه است یا صفحه هنوز بارگذاری نشده
- مقدار `--delay` را بیشتر کن: `--delay 1.5`
- یک اکشن `wait` قبل از اکشن مشکل‌دار اضافه کن

---

### ❌ `WebDriverException: ChromeDriver not found`

```bash
pip install webdriver-manager
```
سپس در `automation.py`:
```python
from webdriver_manager.chrome import ChromeDriverManager
from selenium.webdriver.chrome.service import Service

# در make_driver:
service = Service(ChromeDriverManager().install())
return webdriver.Chrome(service=service, options=opts)
```

---

### ❌ Ollama جواب نمی‌دهد

- مطمئن شو Ollama در حال اجراست: `ollama serve`
- مدل را بررسی کن: `ollama list`
- آدرس پیش‌فرض: `http://localhost:11434`

---

### ❌ تایپ در contenteditable کار نمی‌کند

در فایل JSON، فیلد `isContentEditable` را اضافه کن:
```json
{
  "type": "input",
  "xpath": "//*[@id=\"prompt-textarea\"]",
  "value": "سلام {1}",
  "isContentEditable": true
}
```

---

## 📜 لایسنس

این پروژه برای استفاده شخصی و آموزشی آزاد است.
