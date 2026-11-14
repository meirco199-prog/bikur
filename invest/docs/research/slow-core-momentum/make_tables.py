"""Build the results tables (Hebrew) from results.json + the frozen XSRA-7 research outputs already in the repo."""
import json, os, sys
R = json.load(open(sys.argv[1])); here = os.path.dirname(os.path.abspath(__file__)); up = os.path.join(here, "..")
pct = lambda x: "—" if x is None else f"{'+' if x >= 0 else '−'}{abs(x) * 100:.1f}%"
f2 = lambda x: "—" if x is None else f"{x:.2f}"
W = [("since_2022", "מ-2022"), ("training", "אימון*"), ("validation", "אימות"), ("test", "מבחן")]
NAMES = [("base", "Slow Core Momentum (הראשית)"), ("double_slippage", "עמידות: החלקה כפולה"), ("delay_two_days", "עמידות: ביצוע מאוחר ביום"),
         ("info_fee_0.10pct", "מידע: עמלה 0.1% (כמו XSRA-7)"), ("bench_btc_matched", "ביטקוין קנה-והחזק (מאותו יום)"),
         ("bench_eq3_passive", "שליש ביטקוין/אתריום/סולאנה, קנה-והחזק")]
L = ["| | " + " | ".join(f"{n}: תשואה / ירידה / שארפ" for _, n in W) + " | מחזור בשנה (מ-2022) | עלויות מ-2022 | חשיפה |", "|---|" + "---|" * (len(W) + 3)]
for k, n in NAMES:
    r = R[k]; cells = []
    for w, _ in W:
        m = r[w]; cells.append("—" if m["status"] != "MEASURED" else f"{pct(m['cagr'])} / {pct(m['max_drawdown'])} / {f2(m['sharpe'])}")
    s = r["since_2022"]; L.append(f"| {n} | " + " | ".join(cells) + f" | פי {s['annual_turnover']:.1f} | {pct(-s['cost_pct_of_start'])} | {round(s['exposure'] * 100)}% |")
cov = R["base"]["training"]; L += ["", f"*אימון: לפי הפרוטוקול המסחר מתחיל ב-1/1/2022, ולכן בפועל נמדדו רק {cov.get('days', 0)} ימים ({cov.get('first', '—')} → {cov.get('last', '—')}) מתוך 2016-07 → 2022-07.", ""]
# XSRA-7 — frozen research outputs (7כ, שכבה 3, פקודה של 5,000$; 7כו לפי שנה). לא מסונתז מחדש.
try:
    x = json.load(open(os.path.join(up, "xs-validate", "results.json")))["layers"]["L3"]["base"]["5000"]
    y = json.load(open(os.path.join(up, "xsra-50k", "results.json")))["yearlyReal"]["base"]
    L += ["**XSRA-7 — תוצאות מחקר קפואות מהריפו** (7כ, שכבה 3: 38 מטבעות Bybit, תאריכי רישום, עמלה 0.1% + החלקה לפי ספר הפקודות; מבחן מ-2024-09-05). **עלויות ותאריכים לא זהים** — להשוואה כללית בלבד, לא חלק מהפסיקה:", "",
          "| | מ-2022: תשואה / ירידה / שארפ | מבחן: תשואה / ירידה / שארפ | מחזור בשנה | " + " | ".join(sorted(y)) + " |", "|---|---|---|---|" + "---|" * len(y),
          f"| XSRA-7 (בלי הגנות) | {pct(x['s22']['cagr'])} / {pct(-x['s22']['maxDD'])} / {f2(x['s22']['sharpe'])} | {pct(x['test']['cagr'])} / {pct(-x['test']['maxDD'])} / {f2(x['test']['sharpe'])} | פי {x['s22']['turnYr']:.1f} | " + " | ".join(pct(y[k]['ret']) for k in sorted(y)) + " |", ""]
except Exception as e:
    L += [f"(XSRA-7: לא נמצאו תוצאות קפואות — {e})", ""]
ys = sorted(R["yearly"]["base"]); L += ["**תשואה לפי שנה**", "", "| | " + " | ".join(ys) + " |", "|---|" + "---|" * len(ys)]
for k, n in [("base", "Slow Core Momentum"), ("bench_btc_matched", "ביטקוין"), ("bench_eq3_passive", "שליש לכל נכס")]:
    L.append(f"| {n} | " + " | ".join(pct(R["yearly"][k].get(y)) for y in ys) + " |")
p = R["phase_robustness"]; rc = R["random_control"]; v = R["verdict"]
L += ["", f"**30 מועדי התחלה (0–29 ימים):** תשואה שנתית מ-2022 בין {pct(p['min'])} ל-{pct(p['max'])} (חציון {pct(p['median'])}); פער {p['spread'] * 100:.1f} נקודות — {'פחות' if p['spread_lt_6pp'] else 'יותר'} מ-6 (מדד משני).",
      f"**בחירה אקראית בין הכשירים ({rc['trials']} הרצות):** חציון {pct(rc['median_cagr'])}; השיטה מעל {rc['pct_trials_below_strategy'] * 100:.0f}% מההרצות ({rc['identical_trials']} הרצות זהות לשיטה — כשרק שניים כשירים אין מה לבחור).",
      "", "**הפסיקה לפי הפרוטוקול:** " + " · ".join(f"{k}: {s}" for k, s in v["items"].items()) + f" → **{v['overall']}**"]
print("\n".join(L))
