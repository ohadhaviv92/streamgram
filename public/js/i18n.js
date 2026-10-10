import { ru, ar } from "./translations.js";
const he = {
  "Example: searching in English finds this title:": "לדוגמה: חיפוש באנגלית כולל את השם הזה:",
  "Example: searching in the selected language includes both titles:": "לדוגמה: חיפוש בשפה שנבחרה כולל את שני השמות:",
  "Sets the default language for searching Telegram by movie and series titles. Accounts using the instance default inherit this search language.": "זו שפת החיפוש בטלגרם לפי שמות סרטים וסדרות. משתמשים שבוחרים בברירת המחדל של השרת מחפשים בשפה זו.",
  "Sets the language for searching Telegram by movie and series titles for this account. Use instance default follows the server’s search language.": "זו שפת החיפוש בטלגרם לפי שמות סרטים וסדרות עבור המשתמש הזה. בחירה בברירת המחדל משתמשת בשפת החיפוש של השרת.",
  "Menu": "תפריט",
  "Close menu": "סגירת התפריט",
  "English is always searched. Selecting another language adds searches in that language.": "החיפוש תמיד כולל אנגלית. בחירת שפה נוספת מוסיפה חיפושים בשפה זו.",
  "Removes cached search results, message details, folders, and channel video lists for all accounts.": "מסיר תוצאות חיפוש, פרטי הודעות, תיקיות ורשימות סרטונים בערוצים מהמטמון של כל החשבונות.",
  "Regenerate QR code": "יצירת קוד QR חדש",
  "Connections need attention": "יש בעיות בחיבורים",
  "Connections could not be verified": "לא ניתן לאמת את החיבורים",
  "Open Settings": "פתיחת ההגדרות",
  "Configuration checks": "בדיקות הגדרות",
  "Check again": "בדיקה חוזרת",
  "Checking…": "בודק…",
  "Settings saved": "ההגדרות נשמרו",
  "Telegram API": "API של טלגרם",
  "TMDB API": "API של TMDB",
  "Streaming HTTPS": "HTTPS לסטרימינג",
  "Passed": "עבר",
  "Failed": "נכשל",
  "Unverified": "לא אומת",
  "Last checked": "בדיקה אחרונה",
  "Settings saved, but checks could not finish. Try again.": "ההגדרות נשמרו, אך הבדיקות לא הושלמו. נסו שוב.",
  "Checks could not finish. Try again.": "הבדיקות לא הושלמו. נסו שוב.",
  "Telegram accepted the API ID and hash.": "טלגרם אישר את מזהה ה־API ואת ה־hash.",
  "Telegram rejected the API ID or hash.": "טלגרם דחה את מזהה ה־API או את ה־hash.",
  "Telegram has restricted this API ID. Use different Telegram API credentials.": "טלגרם הגביל את מזהה ה־API הזה. השתמשו בפרטי API אחרים של טלגרם.",
  "Telegram rate-limited the check. Try again later.": "טלגרם הגביל את קצב הבדיקות. נסו שוב מאוחר יותר.",
  "Could not verify Telegram credentials within 10 seconds. Try again later.": "לא ניתן לאמת את פרטי טלגרם תוך 10 שניות. נסו שוב מאוחר יותר.",
  "Enter a positive Telegram API ID and a 32-character hexadecimal API hash.": "הזינו מזהה API חיובי של טלגרם ו־API hash עם 32 תווים הקסדצימליים.",
  "TMDB bearer token is missing.": "חסר טוקן גישה של TMDB.",
  "TMDB rejected the bearer token.": "TMDB דחה את טוקן הגישה.",
  "TMDB API is working.": "ה־API של TMDB עובד.",
  "TMDB returned an unexpected response. Try again later.": "TMDB החזיר תגובה לא צפויה. נסו שוב מאוחר יותר.",
  "Could not reach TMDB within 10 seconds or verify its response.": "לא ניתן להגיע ל־TMDB תוך 10 שניות או לאמת את תגובתו.",
  "Use an HTTPS public URL without credentials, query parameters, or fragments.": "השתמשו בכתובת HTTPS ציבורית ללא פרטי התחברות, פרמטרים או מקטעים.",
  "Streaming URL redirects. Use the final HTTPS URL.": "כתובת הסטרימינג מפנה לכתובת אחרת. השתמשו בכתובת HTTPS הסופית.",
  "HTTPS reaches this StreamGram instance with a valid certificate.": "HTTPS מגיע למופע StreamGram זה עם תעודה תקפה.",
  "The public URL did not return this StreamGram instance.": "הכתובת הציבורית לא החזירה את מופע StreamGram הזה.",
  "Could not reach the streaming URL within 10 seconds or verify its TLS certificate and response.": "לא ניתן להגיע לכתובת הסטרימינג תוך 10 שניות או לאמת את תעודת TLS ואת התגובה.",

  "Invalid admin password": "סיסמת המנהל שגויה",
  "Admin login required": "נדרשת כניסת מנהל",
  "Missing or invalid user token": "קישור החשבון חסר או לא תקין",
  "Missing personal account link": "קישור החשבון האישי חסר",
  "Authentication expired. Start again.": "תוקף האימות פג. התחילו מחדש.",
  "Reconnect with the same Telegram account":
    "יש להתחבר מחדש עם אותו חשבון טלגרם",
  "Code or password could not be verified. Try again.":
    "לא ניתן לאמת את הקוד או הסיסמה. נסו שוב.",

  "Interface language": "שפת הממשק",
  Overview: "סקירה",
  Accounts: "חשבונות",
  Invitations: "הזמנות",
  Hi: "שלום",
  "you’re invited to StreamGram": "הוזמנת ל־StreamGram",
  Settings: "הגדרות",
  Tutorials: "מדריכים",
  Management: "ניהול",
  "Personal account": "החשבון שלי",
  "Sign out": "יציאה",
  "Sign in": "כניסה",
  "Admin password": "סיסמת מנהל",
  "Welcome back": "ברוכים השבים",
  "Sign in to manage your StreamGram instance.":
    "היכנסו כדי לנהל את מופע StreamGram שלכם.",
  "Manage your Telegram accounts and Stremio connections in one place.":
    "נהלו את חשבונות הטלגרם והחיבורים לסטרימיו במקום אחד.",
  "Add account": "הוספת חשבון",
  "Create invitation": "יצירת הזמנה",
  "Telegram accounts": "חשבונות טלגרם",
  "Active invitations": "הזמנות פעילות",
  "Admin protection": "הגנת מנהל",
  Enabled: "פעילה",
  Disabled: "כבויה",
  Connected: "מחובר",
  "Reconnect needed": "נדרש חיבור מחדש",
  "View all": "הצגת הכל",
  Account: "חשבון",
  "Open personal page": "פתיחת העמוד האישי",
  "Copy manifest": "העתקת מניפסט",
  Delete: "מחיקה",
  Cancel: "ביטול",
  Close: "סגירה",
  "Copy link": "העתקת קישור",
  Copy: "העתקה",
  "Copied to clipboard": "הועתק ללוח",
  "Manifest copy to clipboard": "המניפסט הועתק ללוח",
  "No accounts yet": "אין עדיין חשבונות",
  "Connect Telegram to start streaming in Stremio.":
    "חברו טלגרם כדי להתחיל לצפות בסטרימיו.",
  "Connect Telegram": "חיבור טלגרם",
  "Reconnect Telegram": "חיבור טלגרם מחדש",
  "Private links provide access to each account. Share them only with their owner.":
    "קישורים פרטיים מעניקים גישה לחשבון. שתפו אותם רק עם בעל החשבון.",
  "Invite someone to connect their own Telegram account.":
    "הזמינו מישהו לחבר את חשבון הטלגרם שלו.",
  "Single use · Valid for 7 days": "שימוש חד פעמי · בתוקף לשבעה ימים",
  "No invitations yet": "אין עדיין הזמנות",
  "Create a private link to invite your first user.":
    "צרו קישור פרטי כדי להזמין את המשתמש הראשון.",
  "Invitation ready": "ההזמנה מוכנה",
  "Copy this link now. It is shown only once.":
    "העתיקו את הקישור כעת. הוא מוצג פעם אחת בלבד.",
  Revoke: "ביטול הזמנה",
  active: "פעילה",
  used: "נוצלה",
  expired: "פגה",
  revoked: "בוטלה",
  Expires: "בתוקף עד",
  Block: "חסימה",
  Unblock: "ביטול חסימה",
  Blocked: "חסום",
  Created: "נוצרה",
  "Instance credentials": "פרטי המופע",
  "Public URL": "כתובת ציבורית",
  "Telegram API ID": "מזהה API של טלגרם",
  "Telegram API hash": "מפתח API של טלגרם",
  "TMDB bearer token": "טוקן TMDB",
  "Get your API ID and hash from Telegram": "קבלת מזהה ומפתח API מטלגרם",
  "View tutorial": "הצגת המדריך",
  "Step-by-step help for setting up and using StreamGram.":
    "עזרה שלב אחר שלב להגדרה ולשימוש ב־StreamGram.",
  "How do I create a Telegram API ID and API hash?":
    "איך יוצרים מזהה API ומפתח API של טלגרם?",
  "How do I create a TMDB API Read Access Token?":
    "איך יוצרים טוקן גישה לקריאת נתונים ב־TMDB?",
  "Watch this guide to create the credentials StreamGram needs from Telegram.":
    "צפו במדריך כדי ליצור את פרטי החיבור ש־StreamGram צריך מטלגרם.",
  "Watch this guide to get the TMDB API Read Access Token StreamGram needs.":
    "צפו במדריך כדי לקבל את טוקן הגישה לקריאת נתונים ב־TMDB ש־StreamGram צריך.",
  "Quick steps": "צעדים מהירים",
  "Sign in to my.telegram.org using your Telegram account.":
    "התחברו אל my.telegram.org באמצעות חשבון הטלגרם שלכם.",
  "Open API development tools and create an app if Telegram asks for one.":
    "פתחו את API development tools וצרו אפליקציה אם טלגרם מבקשת זאת.",
  "Copy both values into the Instance credentials section in StreamGram Settings.":
    "העתיקו את שני הערכים לאזור פרטי המופע בהגדרות StreamGram.",
  "Save your settings.": "שמרו את ההגדרות.",
  "Sign in to your TMDB account.": "התחברו לחשבון ה־TMDB שלכם.",
  "Open Settings → API.": "פתחו הגדרות ← API.",
  "Create or copy the API Read Access Token (v4).":
    "צרו או העתיקו את טוקן הגישה לקריאת נתונים (v4).",
  "Paste the token into the TMDB bearer token field in StreamGram Settings.":
    "הדביקו את הטוקן בשדה טוקן ה־TMDB בהגדרות StreamGram.",
  "Open Telegram API portal": "פתיחת פורטל ה־API של טלגרם",
  "Open TMDB API settings": "פתיחת הגדרות ה־API של TMDB",
  "Watch on YouTube": "צפייה ב־YouTube",
  "Keep your API hash private.": "שמרו על מפתח ה־API שלכם פרטי.",
  "Keep your TMDB token private.": "שמרו על טוקן ה־TMDB שלכם פרטי.",
  "Only enter it in your own StreamGram instance.":
    "הזינו אותו רק במופע StreamGram האישי שלכם.",
  "Get your API Read Access Token from TMDB":
    "קבלת טוקן גישה לקריאת נתונים מ־TMDB",
  "Default search language": "שפת חיפוש ברירת מחדל",
  English: "אנגלית",
  Hebrew: "עברית",
  Russian: "רוסית",
  Arabic: "ערבית",
  "Save changes": "שמירת שינויים",
  "Changes saved": "השינויים נשמרו",
  "Leave blank to keep the saved secret": "השאירו ריק כדי לשמור על הסוד הקיים",
  "Protect management with a password": "הגנת הניהול באמצעות סיסמה",
  "New admin password": "סיסמת מנהל חדשה",
  "Use at least 8 characters.": "השתמשו ב־8 תווים לפחות.",
  "When protection is disabled, anyone who can reach this instance can manage it.":
    "כשההגנה כבויה, כל מי שיכול לגשת למופע יכול לנהל אותו.",
  "Backup & restore": "גיבוי ושחזור",
  "Backups contain private Telegram sessions. Store them securely.":
    "גיבויים מכילים חיבורי טלגרם פרטיים. שמרו אותם במקום בטוח.",
  "Download backup": "הורדת גיבוי",
  "Choose backup": "בחירת גיבוי",
  "Restore backup": "שחזור גיבוי",
  "Restore this backup?": "לשחזר את הגיבוי?",
  "This replaces accounts and preferences. Your current admin protection is kept. Invitations and browser sessions will be invalidated.":
    "השחזור מחליף חשבונות והעדפות. הגנת המנהל הנוכחית נשמרת. ההזמנות וחיבורי הדפדפן יבוטלו.",
  Cache: "מטמון",
  "Clear cache": "ניקוי מטמון",
  "Cache cleared": "המטמון נוקה",
  "Ready when you are.": "מוכנים לצפייה.",
  "Install in Stremio": "התקנה בסטרימיו",
  "Install in Nuvio": "התקנה ב־Nuvio",
  "Connect your Telegram library to Stremio or Nuvio.": "חברו את ספריית הטלגרם ל־Stremio או Nuvio.",
  "For TV or another device, copy the manifest URL and add it in the app.": "בטלוויזיה או במכשיר אחר, העתיקו את כתובת המניפסט והוסיפו אותה באפליקציה.",
  "Connect your Telegram library to Stremio. Catalogs are optional.":
    "חברו את ספריית הטלגרם לסטרימיו. בחירת קטלוגים היא אופציונלית.",
  "Manifest URL": "כתובת מניפסט",
  "Keep this link private. It grants access to your account.":
    "שמרו על הקישור פרטי. הוא מעניק גישה לחשבון שלכם.",
  "Account preferences": "העדפות חשבון",
  "Display name": "שם תצוגה",
  "Display name (optional)": "שם תצוגה (אופציונלי)",
  "Search language": "שפת חיפוש",
  "Use instance default": "ברירת מחדל של המופע",
  "Channel and folder catalogs (optional)": "קטלוגי ערוצים ותיקיות (אופציונלי)",
  "Browse selected folders and channels inside Stremio. You can install without selecting any.":
    "דפדפו בתיקיות ובערוצים נבחרים בסטרימיו. ניתן להתקין גם ללא בחירה.",
  "Load folders and channels": "טעינת תיקיות וערוצים",
  "Refresh folders and channels": "רענון תיקיות וערוצים",
  Folders: "תיקיות",
  Channels: "ערוצים",
  "Search channels": "חיפוש ערוצים",
  "Save catalogs": "שמירת קטלוגים",
  "Catalogs saved": "הקטלוגים נשמרו",
  "No items found": "לא נמצאו פריטים",
  "Could not load this list. Try again.": "לא ניתן לטעון את הרשימה. נסו שוב.",
  "Account controls": "ניהול החשבון",
  "Reconnect using the same Telegram account. Your private link and preferences stay the same.":
    "התחברו מחדש עם אותו חשבון טלגרם. הקישור הפרטי וההעדפות נשמרים.",
  "Delete account": "מחיקת חשבון",
  "Delete this account?": "למחוק את החשבון?",
  "Its private links will stop working. This does not delete your Telegram account.":
    "הקישורים הפרטיים יפסיקו לעבוד. חשבון הטלגרם עצמו לא יימחק.",
  "Account deleted": "החשבון נמחק",
  "Your connection has been removed.": "החיבור שלכם הוסר.",
  "QR code": "קוד QR",
  "Phone code": "קוד לטלפון",
  "Open Telegram → Settings → Devices → Add Device → Scan QR code.":
    "פתחו טלגרם ← הגדרות ← מכשירים ← הוספת מכשיר ← סריקת קוד QR.",
  "Generate QR code": "יצירת קוד QR",
  "Phone number": "מספר טלפון",
  "Send code": "שליחת קוד",
  "Verification code": "קוד אימות",
  "Verify & connect": "אימות וחיבור",
  "Telegram password": "סיסמת טלגרם",
  "Enter your Telegram two-step verification password.":
    "הזינו את סיסמת האימות הדו־שלבי שלכם בטלגרם.",
  "Incorrect Telegram password. Try again.": "סיסמת הטלגרם שגויה. נסו שוב.",
  "Could not verify your Telegram password. Try again.":
    "לא ניתן לאמת את סיסמת הטלגרם. נסו שוב.",
  "Phone number (with country code)": "מספר טלפון (כולל קידומת מדינה)",
  "+Country code and phone number": "+קידומת מדינה ומספר טלפון",
  "Use your country code, such as +1, +44 or +91. Spaces, dashes and parentheses are accepted.":
    "השתמשו בקידומת המדינה שלכם, למשל ‎+1, ‎+44 או ‎+91. ניתן להזין רווחים, מקפים וסוגריים.",
  "Enter your phone number with its country code, starting with +.":
    "הזינו מספר טלפון עם קידומת מדינה, שמתחיל ב־+.",
  "Code sent to your Telegram app": "הקוד נשלח לאפליקציית הטלגרם שלכם",
  "Code sent via SMS": "הקוד נשלח בהודעת SMS",
  Continue: "המשך",
  "Waiting to scan...": "ממתינים לסריקה...",
  "QR code expired. Generate a new one.": "תוקף קוד ה־QR פג. צרו קוד חדש.",
  "Welcome to StreamGram": "ברוכים הבאים ל־StreamGram",
  "A few steps to your own streaming dashboard.":
    "כמה צעדים ללוח הבקרה האישי שלכם.",
  Protection: "הגנה",
  Credentials: "פרטי חיבור",
  Telegram: "טלגרם",
  Install: "התקנה",
  "Secure your dashboard": "אבטחת לוח הבקרה",
  "Set up your instance": "הגדרת המופע",
  "Existing environment settings are prefilled. Blank secret fields keep saved values.":
    "הגדרות סביבה קיימות נטענות מראש. שדות סודיים ריקים שומרים ערכים קיימים.",
  "Save & continue": "שמירה והמשך",
  Back: "חזרה",
  "Go to dashboard": "מעבר ללוח הבקרה",
  "You’re invited": "הוזמנתם",
  "Connect your Telegram account to get your own private Stremio installation.":
    "חברו את חשבון הטלגרם שלכם כדי לקבל התקנת סטרימיו פרטית.",
  "Invitation unavailable": "ההזמנה אינה זמינה",
  "This invitation has expired. Ask your admin for a new link.":
    "תוקף ההזמנה פג. בקשו מהמנהל קישור חדש.",
  "This invitation was revoked. Ask your admin for a new link.":
    "ההזמנה בוטלה. בקשו מהמנהל קישור חדש.",
  "This invitation was already used. Open your personal configure link instead.":
    "ההזמנה כבר נוצלה. פתחו את קישור ההגדרות האישי שלכם.",
  "This invitation could not be found. Check the link with your admin.":
    "ההזמנה לא נמצאה. בדקו את הקישור עם המנהל.",
  "Unable to open this page": "לא ניתן לפתוח את העמוד",
  Retry: "ניסיון נוסף",
  "Loading…": "טוען…",
  "Private instance": "מופע פרטי",
  "Session expires after 8 hours.": "החיבור תקף לשמונה שעות.",
  "Configuration incomplete": "ההגדרה לא הושלמה",
  "Connect a Telegram account": "חברו חשבון טלגרם",
  "Your API credentials are set. Add a Telegram account to start streaming in Stremio.":
    "פרטי ה־API הוגדרו. הוסיפו חשבון טלגרם כדי להתחיל לצפות בסטרימיו.",
  "Finish instance credentials in Settings to enable streaming.":
    "השלימו את פרטי המופע בהגדרות כדי לאפשר צפייה.",
  "Share link": "שיתוף קישור",
  "Sources loaded": "המקורות נטענו",
  "Ready to install": "מוכן להתקנה",
  "Skip to content": "דילוג לתוכן",
};
export const supportedLanguages = { en: "English", he: "עברית", ru: "Русский", ar: "العربية" };
const supported = (value) => Object.hasOwn(supportedLanguages, value);
const urlLanguage = new URLSearchParams(location.search).get("lng");
const savedLanguage = localStorage.getItem("streamgram-ui-language");
export const language = supported(urlLanguage)
  ? urlLanguage
  : supported(savedLanguage)
    ? savedLanguage
    : "en";
export const t = (text) => ({ he, ru, ar }[language]?.[text] || text);
export function applyLanguage() {
  document.documentElement.lang = language;
  document.documentElement.dir = ["he", "ar"].includes(language) ? "rtl" : "ltr";
  document.querySelector(".skip").textContent = t("Skip to content");
}
