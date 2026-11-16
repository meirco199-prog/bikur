#!/usr/bin/env python3
"""שער הנתונים בלבד (PROTOCOL_v1.1 §3, §6–7): בדיקת זמינות, איכות ונזילות של ארבע רגלי ה-Iron Condor בקובצי הדגימה של Tardis.
אין כאן Backtest, אין תשואה ואין רווח: רק האם אפשר לזהות את הרגליים, האם יש קנייה/מכירה אמיתיות ועומק, והאם עסקה בסיכון
של עד 4,000$ (8% מ-50,000$) הייתה ניתנת לביצוע לפי הספר. כללי הבחירה מהפרוטוקול, בלי שינוי:
  - החלטה ב-12:00 UTC (מצב options_chain האחרון עד 12:00), ביצוע ב-12:05 (ספר book_snapshot_25 האחרון עד 12:05).
  - פקיעה הקרובה ביותר ל-30 יום בטווח 25–35 (שוויון: המוקדמת).
  - רגליים: פוט −0.25 / −0.10, קול +0.25 / +0.10 לפי הדלתא של הבורסה; הסטרייק הרשום עם הדלתא הקרובה ביותר (שוויון: הרחוק יותר מהכסף).
  - מכירה במחירי הקנייה (bid) וקנייה במחירי המכירה (ask), הליכה בספר לכל הכמות. אין מילוי באמצע.
עמלות (לחישוב הסיכון המקסימלי בלבד): עמלת לוקח 0.03% מהבסיס (0.0003 BTC לחוזה), תקרה 12.5% ממחיר האופציה — לפי לוח העמלות
שפורסם; ההיסטוריה של הלוח לא אומתה כאן.
שימוש: analyze.py RAW_DIR OUT_JSON OUT_MD
"""
import csv, glob, gzip, json, math, os, sys
from datetime import datetime, timezone

RAW, OUT_JSON, OUT_MD = sys.argv[1], sys.argv[2], sys.argv[3]
CAP_RISK = {50000: 4000.0, 100000: 8000.0}
FEE_BTC, FEE_CAP = 0.0003, 0.125
STALE_S = 300  # ציטוט שלא התעדכן 5 דקות ומעלה — "מיושן" (סימון בלבד)
TARGET = {'SP': ('P', -0.25), 'LP': ('P', -0.10), 'SC': ('C', 0.25), 'LC': ('C', 0.10)}
SIDE = {'SP': 'sell', 'LP': 'buy', 'SC': 'sell', 'LC': 'buy'}
LAB = {'SP': 'פוט נמכר ~25', 'LP': 'פוט קנוי ~10', 'SC': 'קול נמכר ~25', 'LC': 'קול קנוי ~10'}
csv.field_size_limit(10**9)


def f(x):
    try:
        v = float(x)
        return v if math.isfinite(v) else None
    except (TypeError, ValueError):
        return None


def read_rows(path):
    if not os.path.exists(path):
        return {}
    with open(path, newline='') as fh:
        r = csv.DictReader(fh)
        return {row['symbol']: row for row in r if row.get('symbol')}


def meta(path):
    out = {}
    if os.path.exists(path):
        for line in open(path):
            if '=' in line:
                k, v = line.strip().split('=', 1)
                out[k] = v
    return out


def levels(row, side):
    """book_snapshot_25: asks[i].price / asks[i].amount ..."""
    out = []
    for i in range(25):
        p, a = f(row.get(f'{side}[{i}].price')), f(row.get(f'{side}[{i}].amount'))
        if p is not None and a is not None and a > 0:
            out.append((p, a))
    return out


def walk(lv, n):
    got, cost = 0.0, 0.0
    for p, a in lv:
        take = min(a, n - got)
        if take <= 0:
            break
        got += take; cost += take * p
    return got, (cost / got if got else None)


def month(mdir):
    m = os.path.basename(mdir)
    day0 = datetime.strptime(m + '-01', '%Y-%m-%d').replace(tzinfo=timezone.utc).timestamp()
    T0, T5 = int((day0 + 12 * 3600) * 1e6), int((day0 + 12 * 3600 + 300) * 1e6)
    res = {'month': m, 'files': {}}
    for ds in ('options_chain', 'book_snapshot_25', 'quotes'):
        mt = meta(f'{mdir}/{ds}.meta'); err = open(f'{mdir}/{ds}.curl.err').read().strip() if os.path.exists(f'{mdir}/{ds}.curl.err') else ''
        res['files'][ds] = {'rows_read': int(mt.get('rows_read', 0) or 0), 'rows_btc': int(mt.get('rows_btc', 0) or 0), 'reached_1210': mt.get('reached_1210') == '1', 'seconds': mt.get('seconds'), 'error': err[:200]}
    tr = f'{mdir}/trades.btc.csv.gz'
    trades = {}
    tr_err = None
    if os.path.exists(tr):
        try:  # קובץ שנקטע בהורדה (הריגה אחרי מגבלת זמן) — נספר עד נקודת הקטיעה ומסומן
            with gzip.open(tr, 'rt', newline='') as fh:
                for row in csv.DictReader(fh):
                    trades.setdefault(row['symbol'], []).append(int(row['timestamp']))
        except (EOFError, OSError, ValueError, KeyError) as e:
            tr_err = f'קובץ חלקי: {type(e).__name__}'
    res['files']['trades'] = {'btc_option_trades_day': sum(len(v) for v in trades.values()), 'error': tr_err}
    chain = read_rows(f'{mdir}/options_chain.t1200.csv')
    book = read_rows(f'{mdir}/book_snapshot_25.t1205.csv')
    quotes = read_rows(f'{mdir}/quotes.t1205.csv')
    win = {}
    if os.path.exists(f'{mdir}/book_snapshot_25.win.csv'):
        for row in csv.DictReader(open(f'{mdir}/book_snapshot_25.win.csv')):
            win[row['symbol']] = int(row['updates_1155_1210'])
    res['chain_instruments'] = len(chain); res['book_instruments'] = len(book)
    if not chain:
        res['status'] = 'אין נתוני options_chain'; return res
    # פקיעה
    exps = {}
    for s, r in chain.items():
        e = f(r.get('expiration'))
        if e and e > T0:
            exps.setdefault(int(e), []).append(s)
    dte = {e: (e - T0) / 86400e6 for e in exps}
    cand = sorted([e for e in exps if 25 <= dte[e] <= 35], key=lambda e: (abs(dte[e] - 30), e))
    res['expiries_listed'] = len(exps)
    res['nearest_dte'] = round(min(dte.values(), key=lambda d: abs(d - 30)), 2) if dte else None
    if not cand:
        res['status'] = 'אין פקיעה בטווח 25–35 יום'; return res
    E = cand[0]; res['expiry'] = datetime.fromtimestamp(E / 1e6, timezone.utc).strftime('%Y-%m-%d %H:%M'); res['dte'] = round(dte[E], 2)
    syms = exps[E]
    S = None
    for s in syms:
        S = f(chain[s].get('underlying_price')) or S
    res['underlying_price'] = S
    # IV ליד הכסף (זמינות הקלט בלבד — לא מחושב יחס IV/RV)
    atm = min(syms, key=lambda s: abs((f(chain[s].get('strike_price')) or 0) - (S or 0)))
    res['atm_mark_iv_available'] = f(chain[atm].get('mark_iv')) is not None
    legs = {}
    for k, (typ, tgt) in TARGET.items():
        opts = [s for s in syms if chain[s].get('type', '').lower().startswith('p' if typ == 'P' else 'c') and f(chain[s].get('delta')) is not None]
        if not opts:
            legs[k] = None; continue
        far = (lambda s: f(chain[s]['strike_price'])) if typ == 'C' else (lambda s: -f(chain[s]['strike_price']))
        best = min(opts, key=lambda s: (abs(f(chain[s]['delta']) - tgt), -far(s)))
        legs[k] = best
    res['legs'] = {}
    ok_struct = all(legs.values())
    if ok_struct:
        K = {k: f(chain[legs[k]]['strike_price']) for k in legs}
        ok_struct = K['LP'] < K['SP'] < (S or 0) < K['SC'] < K['LC'] if S else K['LP'] < K['SP'] and K['SC'] < K['LC']
    res['four_distinct_legs'] = bool(ok_struct)
    for k, s in legs.items():
        if not s:
            res['legs'][k] = {'symbol': None}; continue
        c = chain[s]; b = book.get(s); q = quotes.get(s)
        bids, asks = (levels(b, 'bids'), levels(b, 'asks')) if b else ([], [])
        book_age = (T5 - int(b['timestamp'])) / 1e6 if b else None
        bid, ask = (bids[0][0] if bids else None), (asks[0][0] if asks else None)
        L = {'symbol': s, 'strike': f(c['strike_price']), 'delta': f(c['delta']), 'chain_age_s': round((T0 - int(c['timestamp'])) / 1e6, 1),
             'chain_bid': f(c.get('bid_price')), 'chain_ask': f(c.get('ask_price')), 'mark': f(c.get('mark_price')), 'mark_iv': f(c.get('mark_iv')),
             'book': bool(b), 'book_age_s': round(book_age, 1) if book_age is not None else None, 'bid': bid, 'ask': ask,
             'bid_levels': len(bids), 'ask_levels': len(asks), 'bid_depth': round(sum(a for _, a in bids), 2), 'ask_depth': round(sum(a for _, a in asks), 2),
             'bid_top_size': bids[0][1] if bids else 0, 'ask_top_size': asks[0][1] if asks else 0,
             'quote_bid': f(q.get('bid_price')) if q else None, 'quote_ask': f(q.get('ask_price')) if q else None,
             'updates_1155_1210': win.get(s, 0), 'trades_day': len(trades.get(s, []))}
        L['spread_pct'] = round((ask - bid) / ((ask + bid) / 2) * 100, 1) if bid and ask else None
        L['stale'] = book_age is None or book_age > STALE_S
        res['legs'][k] = L
    if not ok_struct:
        res['status'] = 'אין ארבע רגליים נפרדות ותקינות'; return res
    lg = res['legs']
    have_quotes = all(lg[k]['bid' if SIDE[k] == 'sell' else 'ask'] for k in lg)
    res['all_executable_sides_quoted'] = have_quotes
    if not have_quotes:
        res['status'] = 'חסר מחיר בצד הנדרש באחת הרגליים'; return res
    px = {k: (lg[k]['bid'] if SIDE[k] == 'sell' else lg[k]['ask']) for k in lg}
    fee = {k: min(FEE_BTC, FEE_CAP * px[k]) for k in lg}
    credit_btc = px['SP'] + px['SC'] - px['LP'] - px['LC']; fees_btc = sum(fee.values())
    width = max(lg['SP']['strike'] - lg['LP']['strike'], lg['LC']['strike'] - lg['SC']['strike'])
    credit_usd, fees_usd = credit_btc * S, fees_btc * S
    loss1 = width - credit_usd + fees_usd  # הפסד מקסימלי בפקיעה לחוזה אחד (דולר), במחירי הספר העליונים
    res['top'] = {'credit_btc': round(credit_btc, 5), 'credit_usd': round(credit_usd, 1), 'fees_usd_per_contract': round(fees_usd, 2), 'width_usd': width, 'max_loss_per_contract_usd': round(loss1, 1),
                  'credit_after_fees_positive': credit_btc > fees_btc}
    res['size'] = {}
    for cap, risk in CAP_RISK.items():
        n = math.floor(risk / loss1 * 10) / 10 if loss1 > 0 else 0.0
        r = {'contracts': n}
        if n >= 0.1:
            fills, vw = {}, {}
            for k in lg:
                lv = (levels(book[lg[k]['symbol']], 'bids') if SIDE[k] == 'sell' else levels(book[lg[k]['symbol']], 'asks'))
                got, avg = walk(lv, n); fills[k] = round(got, 2); vw[k] = avg
            full = all(fills[k] >= n - 1e-9 for k in lg)
            r['filled'] = fills; r['fully_executable'] = full
            r['both_wings_buyable'] = fills['LP'] >= n - 1e-9 and fills['LC'] >= n - 1e-9
            r['needs_more_than_top_level'] = any(n > (lg[k]['bid_top_size'] if SIDE[k] == 'sell' else lg[k]['ask_top_size']) + 1e-9 for k in lg)
            if full:
                walked = vw['SP'] + vw['SC'] - vw['LP'] - vw['LC']
                r['walk_slippage_usd'] = round((credit_btc - walked) * S * n, 2)
                r['max_loss_walked_usd'] = round((width - walked * S + fees_usd) * n, 1)
        res['size'][cap] = r
    depth = min((lg[k]['bid_depth'] if SIDE[k] == 'sell' else lg[k]['ask_depth']) for k in lg)
    res['capacity_contracts_25_levels'] = depth; res['capacity_max_loss_usd'] = round(depth * loss1, 0)
    res['status'] = 'נבדק'
    return res


months = [month(d) for d in sorted(glob.glob(os.path.join(RAW, '*-*'))) if os.path.isdir(d)]
json.dump(months, open(OUT_JSON, 'w'), ensure_ascii=False, indent=1)

# ---- טבלאות ----
yn = lambda b: '✅' if b else '❌'
L = ['# שער הנתונים — הדגימות שנבדקו בפועל (Tardis, Deribit OPTIONS, היום הראשון בחודש)', '',
     'כל מה שבקובץ הזה הורד ונפתח בפועל ב-GitHub Actions. החלטה ב-12:00 UTC לפי options_chain, ביצוע ב-12:05 לפי book_snapshot_25. אין כאן תשואה, רווח או Backtest.', '',
     '## לפי חודש', '', '| חודש | קבצים | פקיעה (ימים) | 4 רגליים | מרווח (%) SP/LP/SC/LC | גיל הספר (שניות, הגרוע) | עומק בצד הנדרש (BTC) SP/LP/SC/LC | הפסד מקס׳ לחוזה ($) | חוזים ל-4,000$ | ביצוע מלא 50K / 100K | נדרש יותר מרמה אחת | סטטוס |',
     '|---|---|---|---|---|---|---|---|---|---|---|---|']
for r in months:
    fl = r['files']; fok = all(fl[d]['reached_1210'] for d in ('options_chain', 'book_snapshot_25', 'quotes'))
    lg = r.get('legs') or {}
    def cell(fn):
        return '/'.join(str(fn(k, lg[k])) if lg.get(k) and lg[k].get('symbol') else '—' for k in ('SP', 'LP', 'SC', 'LC'))
    sz = r.get('size', {})
    L.append(f"| {r['month']} | {yn(fok)} | {r.get('dte', r.get('nearest_dte', '—'))} | {yn(r.get('four_distinct_legs'))} | {cell(lambda k, x: x.get('spread_pct'))} | "
             f"{max([x.get('book_age_s') or 0 for x in lg.values() if x and x.get('symbol')], default='—')} | "
             f"{cell(lambda k, x: x.get('bid_depth') if SIDE[k] == 'sell' else x.get('ask_depth'))} | "
             f"{r.get('top', {}).get('max_loss_per_contract_usd', '—')} | {sz.get(50000, {}).get('contracts', '—')} | "
             f"{yn(sz.get(50000, {}).get('fully_executable'))} / {yn(sz.get(100000, {}).get('fully_executable'))} | {yn(sz.get(50000, {}).get('needs_more_than_top_level'))} | {r.get('status')} |")
# לפי שנה
L += ['', '## לפי שנה', '', '| שנה | חודשים שנבדקו | קבצים תקינים | פקיעה 25–35 | 4 רגליים | כל הצדדים עם מחיר | ספר עדכני (≤5 דק׳) בכל הרגליים | מרווח חציוני בכנפיים (%) | ביצוע מלא ב-50K | ב-100K |', '|---|---|---|---|---|---|---|---|---|---|']
for y in sorted({r['month'][:4] for r in months}):
    R = [r for r in months if r['month'].startswith(y)]
    fok = [r for r in R if all(r['files'][d]['reached_1210'] for d in ('options_chain', 'book_snapshot_25', 'quotes'))]
    exp = [r for r in R if r.get('expiry')]; four = [r for r in R if r.get('four_distinct_legs')]
    q = [r for r in R if r.get('all_executable_sides_quoted')]
    fresh = [r for r in four if all(not r['legs'][k]['stale'] for k in r['legs'])]
    ws = sorted(x for r in four for k in ('LP', 'LC') for x in [r['legs'][k].get('spread_pct')] if x is not None)
    med = ws[len(ws) // 2] if ws else None
    e50 = [r for r in R if r.get('size', {}).get(50000, {}).get('fully_executable')]; e100 = [r for r in R if r.get('size', {}).get(100000, {}).get('fully_executable')]
    L.append(f'| {y} | {len(R)} | {len(fok)} | {len(exp)} | {len(four)} | {len(q)} | {len(fresh)} | {med if med is not None else "—"} | {len(e50)} | {len(e100)} |')
open(OUT_MD, 'w').write('\n'.join(L) + '\n')
print('\n'.join(L))
