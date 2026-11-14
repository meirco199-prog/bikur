"""Research-only daily backtest. CSV: date,asset,open,close. Never connects to broker."""
import argparse, json
import numpy as np
import pandas as pd

ASSETS = ("BTC", "ETH", "SOL")
FEE = .0005
SLIP = .0002
START = pd.Timestamp("2022-01-01", tz="UTC")
SPLITS = [("training", "2016-07-01", "2022-07-01"),
          ("validation", "2022-07-01", "2024-09-01"),
          ("test", "2024-09-01", "2026-11-14"),
          ("since_2022", "2022-01-01", "2026-11-14")]

def load(path):
    df = pd.read_csv(path)
    if not {"date","asset","open","close"} <= set(df):
        raise ValueError("CSV requires date,asset,open,close")
    df["date"] = pd.to_datetime(df["date"], utc=True).dt.normalize()
    if df.duplicated(["date","asset"]).any(): raise ValueError("duplicate bars")
    if not df.asset.isin(ASSETS).all(): raise ValueError("unknown asset")
    if (df[["open","close"]] <= 0).any().any(): raise ValueError("nonpositive price")
    op = df.pivot(index="date",columns="asset",values="open").reindex(columns=ASSETS)
    cl = df.pivot(index="date",columns="asset",values="close").reindex(columns=ASSETS)
    days = pd.date_range(op.index.min(),op.index.max(),freq="D",tz="UTC")
    return op.reindex(days),cl.reindex(days)

def targets(cl, day):
    h=cl.loc[:day]
    if len(h)<201: return {}
    out=[]
    for asset in ASSETS:
        s=h[asset].dropna()
        if len(s)<201 or s.index[-1]!=day: continue
        if (s.index[-201:].to_series().diff().iloc[1:]!=pd.Timedelta(days=1)).any(): continue
        ret=s.pct_change()
        gain=s.iloc[-1]/s.iloc[-91]-1
        vol90=ret.iloc[-90:].std(ddof=1)
        vol30=ret.iloc[-30:].std(ddof=1)
        if gain>0 and s.iloc[-1]>s.iloc[-200:].mean() and vol90>0 and vol30>0:
            out.append((gain/vol90,asset,vol30))
    out.sort(key=lambda v:(-v[0],v[1]))
    if not out:return {}
    if len(out)==1:return {out[0][1]:.5}
    a,b=out[:2]
    w=np.clip((1/a[2])/((1/a[2])+(1/b[2])),.4,.6)
    return {a[1]:float(w),b[1]:float(1-w)}

def run(op,cl,offset=0,slippage=SLIP,delay=1):
    dates=cl.index
    first=START+pd.Timedelta(days=offset)
    signals={}
    d=first
    while d<=dates[-1]:
        if d in dates:signals[d+pd.Timedelta(days=delay)]=targets(cl,d)
        d+=pd.Timedelta(days=30)
    units={a:0. for a in ASSETS};cash=1.; records=[];trades=[]
    for day in dates:
        if day<START:continue
        if day in signals:
            desired=signals[day]
            px=op.loc[day]
            if any(pd.isna(px[a]) for a in set(desired)|{a for a in ASSETS if units[a]>0}):
                raise ValueError(f"missing execution open {day}")
            nav=cash+sum(units[a]*px[a] for a in ASSETS if units[a]>0)
            # Sell first, then buy using cash; iterative proportional buy scaling accounts for fees.
            for a in ASSETS:
                target=desired.get(a,0)*nav
                current=units[a]*px[a] if units[a]>0 else 0.
                if current>target:
                    qty=(current-target)/px[a]
                    units[a]-=qty;cash+=qty*px[a]*(1-FEE-slippage)
                    trades.append((str(day.date()),a,"SELL",float(qty*px[a])))
            buys=[]
            for a in ASSETS:
                if a not in desired:continue
                needed=max(0.,desired[a]*nav-units[a]*px[a])
                if needed>0:buys.append((a,needed))
            scale=min(1.,cash/(sum(v for _,v in buys)*(1+FEE+slippage))) if buys else 1.
            for a,v in buys:
                spent=v*scale;units[a]+=spent/px[a]
                cash-=spent*(1+FEE+slippage)
                trades.append((str(day.date()),a,"BUY",float(spent)))
        px=cl.loc[day]
        if any(pd.isna(px[a]) for a in ASSETS if units[a]>0):
            raise ValueError(f"missing marking close {day}")
        nav=cash+sum(units[a]*px[a] for a in ASSETS if units[a]>0)
        records.append((day,nav))
    equity=pd.Series(dict(records),dtype=float).sort_index()
    return equity,pd.DataFrame(trades,columns=["date","asset","side","notional"])

def metrics(eq,trades,start,end):
    s=eq.loc[(eq.index>=pd.Timestamp(start,tz="UTC"))&(eq.index<pd.Timestamp(end,tz="UTC"))]
    if len(s)<2:return {"status":"INCONCLUSIVE","days":len(s)}
    yrs=(s.index[-1]-s.index[0]).days/365.25
    cagr=float((s.iloc[-1]/s.iloc[0])**(1/yrs)-1)
    dd=float((s/s.cummax()-1).min())
    rets=s.pct_change().dropna()
    sharpe=float(rets.mean()/rets.std()*np.sqrt(365)) if rets.std()>0 else None
    t=trades.loc[(trades.date>=start)&(trades.date<end)]
    # Approximate turnover using NAV at execution date.
    turnover=sum(float(r.notional)/float(eq.loc[pd.Timestamp(r.date,tz="UTC")])
                 for r in t.itertuples())/yrs
    return dict(status="MEASURED",days=len(s),cagr=cagr,max_drawdown=dd,sharpe=sharpe,
                annual_turnover=turnover,trades=len(t))

def main():
    p=argparse.ArgumentParser()
    p.add_argument("--csv",required=True)
    p.add_argument("--out",default="slow_core_results.json")
    args=p.parse_args()
    op,cl=load(args.csv)
    results={}
    for name,offset,slip,delay in [("base",0,SLIP,1),("double_slippage",0,2*SLIP,1),("delay_two_days",0,SLIP,2)]+[(f"phase_{i}",i,SLIP,1) for i in range(1,30)]:
        eq,tr=run(op,cl,offset,slip,delay)
        results[name]={key:metrics(eq,tr,a,b) for key,a,b in SPLITS}
    with open(args.out,"w") as f:json.dump(results,f,indent=2)
    print(json.dumps(results["base"],indent=2))
    print("NOTE: benchmarks, tax and random-control not implemented; no pass verdict permitted.")
if __name__=="__main__":main()
