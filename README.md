# דשבורד ניחושי מונדיאל 2026

דשבורד סטטי בעברית להצגת דירוג המשתתפים, פירוט ניקוד אישי, משחקים, שאלות פתוחות ומקורות.

## קבצים חשובים

- `index.html` - האפליקציה הראשית
- `data.json` - הנתונים שהדשבורד טוען ומתעדכן מהם
- `leaderboard.csv` - דירוג המשתתפים
- `matches.csv` - משחקים ותוצאות
- `open_questions.csv` - שאלות פתוחות
- `participants_share_links.csv` - קישורים אישיים למשתתפים
- `.nojekyll` - מונע מ-GitHub Pages לעבד את האתר עם Jekyll

## פרסום דרך GitHub Pages

1. צור Repository חדש ב-GitHub בשם לדוגמה: `worldcup-dashboard-2026`.
2. העלה את כל הקבצים שבתיקייה הזו ל-root של ה-Repository.
3. עבור אל `Settings` > `Pages`.
4. תחת `Build and deployment`, בחר:
   - Source: `Deploy from a branch`
   - Branch: `main`
   - Folder: `/root`
5. לחץ Save.
6. אחרי דקה-שתיים האתר יהיה זמין בכתובת:
   `https://USERNAME.github.io/worldcup-dashboard-2026/`

## עדכון ניקוד

כאשר יש עדכון חדש:

1. החלף את `data.json` בקובץ המעודכן.
2. אם יש CSV חדשים, החלף גם אותם.
3. עשה Commit ל-GitHub.
4. GitHub Pages יעדכן את האתר אוטומטית לאותו לינק.

המשתתפים לא צריכים לעשות כלום. הדשבורד בודק עדכונים כל 60 שניות.

## קישורים אישיים

קישור אישי נראה כך:

`https://USERNAME.github.io/worldcup-dashboard-2026/?player=אפי%20קטש`

בקובץ `participants_share_links.csv` יש קישור יחסי לכל משתתף. אחרי שהאתר באוויר, מחליפים את `{PASTE_SITE_URL}` בכתובת האמיתית.
