# Single-Stock Behavioral Edge — תוצאות (PROTOCOL v1.0, commit 98c48c8)

חברי S&P 500 ב-2010: 499 · כשירים: 321 · חסרים: 178 · שילובים שנבדקו: 963 · נבחרו בפיתוח: 15 · סף בונפרוני: p < 0.0033

**פסיקה: FAIL**

## השוואות (CAGR / ירידה מקס׳ / Sharpe)

| | פיתוח | אימות | מבחן | מחוץ למדגם | כל התקופה |
|---|---|---|---|---|---|
| SPY | +11.6% / -19.3% / 0.79 | +13.1% / -33.7% / 0.61 | +19.7% / -18.8% / 0.97 | +16.3% / -33.7% / 0.74 | +13.7% / -33.7% / 0.75 |
| מזומן (‎^IRX) | +0.4% / +0.0% / 0.00 | +1.1% / -0.0% / 0.00 | +4.6% / +0.0% / 0.00 | +2.8% / -0.0% / 0.00 | +1.5% / -0.0% / 0.00 |

## 15 הנבחרים (לפי Sharpe בפיתוח)

| מניה | משפחה | עסקאות פיתוח/מחוץ | פיתוח CAGR / Sharpe | אימות | מבחן | מחוץ למדגם CAGR / Sharpe | ירידה מקס׳ (הכול) | קנה-והחזק מחוץ | p אקראי | בלי 3 הטובות | עלויות ×2 מחוץ | עובר? |
|---|---|---|---|---|---|---|---|---|---|---|---|---|
| UNP | MR | 100/62 | +3.9% / 1.04 | -0.8% | +2.3% | +0.7% / -0.68 | -7.8% | +12.7% | 0.960 | +0.1% | +0.3% | ❌ |
| AAPL | MR | 106/81 | +5.1% / 1.03 | +4.3% | +5.4% | +4.9% / 0.55 | -4.4% | +32.9% | 0.141 | +3.8% | +4.5% | ❌ |
| GOOGL | MR | 112/78 | +3.6% / 0.87 | +1.8% | +8.4% | +5.0% / 0.64 | -4.2% | +24.0% | 0.107 | +4.1% | +4.5% | ❌ |
| UNH | MR | 103/62 | +3.2% / 0.79 | +0.3% | +7.0% | +3.6% / 0.22 | -6.8% | +7.9% | 0.293 | +2.6% | +3.2% | ❌ |
| MA | MR | 95/72 | +2.8% / 0.78 | +3.2% | +5.1% | +4.1% / 0.44 | -5.5% | +17.7% | 0.166 | +3.5% | +3.7% | ❌ |
| NVDA | MOM | 127/124 | +5.9% / 0.77 | +2.0% | +5.4% | +3.7% / 0.13 | -21.2% | +62.9% | 0.842 | +1.1% | +3.0% | ❌ |
| ADSK | MOM | 146/104 | +5.5% / 0.74 | +1.4% | +4.7% | +3.0% / 0.06 | -10.7% | +9.2% | 0.508 | +1.4% | +2.3% | ❌ |
| ETN | MOM | 125/119 | +3.2% / 0.68 | +2.8% | +6.1% | +4.4% / 0.32 | -7.0% | +24.7% | 0.440 | +3.1% | +3.6% | ❌ |
| INTU | MOM | 154/113 | +3.3% / 0.65 | +1.4% | +3.5% | +2.5% / -0.04 | -14.2% | +7.5% | 0.570 | +1.1% | +1.7% | ❌ |
| HD | MOM | 156/106 | +2.7% / 0.64 | -2.6% | +4.7% | +0.9% / -0.41 | -15.5% | +11.7% | 0.875 | -0.0% | +0.3% | ❌ |
| LUV | PB | 24/21 | +2.5% / 0.62 | +0.1% | -3.5% | -1.7% / -0.86 | -24.6% | +1.3% | 0.996 | -2.5% | -1.9% | ❌ |
| RRC | PB | 35/68 | +4.0% / 0.58 | +3.3% | +8.5% | +5.8% / 0.29 | -26.1% | +24.2% | 0.345 | +2.0% | +4.8% | ❌ |
| TMUS | PB | 30/23 | +3.0% / 0.56 | +2.1% | +6.7% | +4.3% / 0.32 | -10.8% | +14.0% | 0.109 | +3.0% | +4.2% | ❌ |
| HBAN | PB | 31/28 | +3.3% / 0.56 | +1.3% | +1.9% | +1.6% / -0.18 | -14.4% | +8.0% | 0.757 | +0.1% | +1.3% | ❌ |
| MAR | PB | 21/28 | +2.3% / 0.56 | +1.7% | +5.7% | +3.6% / 0.18 | -9.6% | +19.9% | 0.419 | +2.0% | +3.4% | ❌ |

## התפלגות כל השילובים והתמדה

| משפחה | שילובים | ספירמן פיתוח↔מחוץ (Sharpe) | CAGR מחוץ: 10/25/50/75/90% | מנצח מזומן | מנצח קנה-והחזק | ≥15% מחוץ | ירידה ≤20% | עסקאות (חציון) |
|---|---|---|---|---|---|---|---|---|
| משפחה 1 — Mean Reversion | 321 | +0.14 | +1.0% / +1.8% / +2.8% / +3.6% / +4.5% | 45% | 16% | 0% | 93% | 137 |
| משפחה 2 — מומנטום קצר | 321 | +0.14 | -0.4% / +0.6% / +1.8% / +3.2% / +4.5% | 32% | 13% | 0% | 60% | 231 |
| משפחה 3 — Pullback | 321 | -0.13 | +1.6% / +2.5% / +3.4% / +4.5% / +5.6% | 69% | 17% | 0% | 90% | 33 |

## קריטריונים לכל נבחר

```
[
{
"UNP/MR": {
"1_cagr_oos_ge_15_and_val_test_pos": false,
"2_mdd_full_le_20": true,
"3_random_p_lt_bonf": false,
"4_no_outliers": false,
"5_double_cost_cagr_oos_ge_15": false
}
},
{
"AAPL/MR": {
"1_cagr_oos_ge_15_and_val_test_pos": false,
"2_mdd_full_le_20": true,
"3_random_p_lt_bonf": false,
"4_no_outliers": true,
"5_double_cost_cagr_oos_ge_15": false
}
},
{
"GOOGL/MR": {
"1_cagr_oos_ge_15_and_val_test_pos": false,
"2_mdd_full_le_20": true,
"3_random_p_lt_bonf": false,
"4_no_outliers": true,
"5_double_cost_cagr_oos_ge_15": false
}
},
{
"UNH/MR": {
"1_cagr_oos_ge_15_and_val_test_pos": false,
"2_mdd_full_le_20": true,
"3_random_p_lt_bonf": false,
"4_no_outliers": false,
"5_double_cost_cagr_oos_ge_15": false
}
},
{
"MA/MR": {
"1_cagr_oos_ge_15_and_val_test_pos": false,
"2_mdd_full_le_20": true,
"3_random_p_lt_bonf": false,
"4_no_outliers": true,
"5_double_cost_cagr_oos_ge_15": false
}
},
{
"NVDA/MOM": {
"1_cagr_oos_ge_15_and_val_test_pos": false,
"2_mdd_full_le_20": false,
"3_random_p_lt_bonf": false,
"4_no_outliers": false,
"5_double_cost_cagr_oos_ge_15": false
}
},
{
"ADSK/MOM": {
"1_cagr_oos_ge_15_and_val_test_pos": false,
"2_mdd_full_le_20": true,
"3_random_p_lt_bonf": false,
"4_no_outliers": false,
"5_double_cost_cagr_oos_ge_15": false
}
},
{
"ETN/MOM": {
"1_cagr_oos_ge_15_and_val_test_pos": false,
"2_mdd_full_le_20": true,
"3_random_p_lt_bonf": false,
"4_no_outliers": true,
"5_double_cost_cagr_oos_ge_15": false
}
},
{
"INTU/MOM": {
"1_cagr_oos_ge_15_and_val_test_pos": false,
"2_mdd_full_le_20": true,
"3_random_p_lt_bonf": false,
"4_no_outliers": false,
"5_double_cost_cagr_oos_ge_15": false
}
},
{
"HD/MOM": {
"1_cagr_oos_ge_15_and_val_test_pos": false,
"2_mdd_full_le_20": true,
"3_random_p_lt_bonf": false,
"4_no_outliers": false,
"5_double_cost_cagr_oos_ge_15": false
}
},
{
"LUV/PB": {
"1_cagr_oos_ge_15_and_val_test_pos": false,
"2_mdd_full_le_20": false,
"3_random_p_lt_bonf": false,
"4_no_outliers": false,
"5_double_cost_cagr_oos_ge_15": false
}
},
{
"RRC/PB": {
"1_cagr_oos_ge_15_and_val_test_pos": false,
"2_mdd_full_le_20": false,
"3_random_p_lt_bonf": false,
"4_no_outliers": false,
"5_double_cost_cagr_oos_ge_15": false
}
},
{
"TMUS/PB": {
"1_cagr_oos_ge_15_and_val_test_pos": false,
"2_mdd_full_le_20": true,
"3_random_p_lt_bonf": false,
"4_no_outliers": true,
"5_double_cost_cagr_oos_ge_15": false
}
},
{
"HBAN/PB": {
"1_cagr_oos_ge_15_and_val_test_pos": false,
"2_mdd_full_le_20": true,
"3_random_p_lt_bonf": false,
"4_no_outliers": false,
"5_double_cost_cagr_oos_ge_15": false
}
},
{
"MAR/PB": {
"1_cagr_oos_ge_15_and_val_test_pos": false,
"2_mdd_full_le_20": true,
"3_random_p_lt_bonf": false,
"4_no_outliers": false,
"5_double_cost_cagr_oos_ge_15": false
}
}
]
```
