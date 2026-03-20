import asyncio
import psycopg2
import psycopg2.extras
import pandas as pd
from datetime import datetime, date, timedelta
from fastapi import FastAPI
from pydantic import BaseModel
from typing import List
import yfinance as yf

# ---------------------------
# Database Layer (sync)
# ---------------------------

def get_connection():
    return psycopg2.connect(
        dbname="railway",
        user="postgres",
        password="gXdNFpPVSftMMasbVNTZFgQoDZVvEHHJ",
        host="autorack.proxy.rlwy.net",
        port=14863
    )

def fetch_daily_returns(ticker, start, end):
    df = yf.download(ticker, start=start, end=end)
    df["daily_return"] = df[("Close", ticker)].pct_change()
    df = df.dropna()
    return df[["daily_return"]]

def load_returns_to_db(ticker, start_date, end_date):
    conn = get_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)
    print(f"Loading for ticker {ticker} started...")
    df = fetch_daily_returns(ticker, start_date, end_date)

    for date_, ret in df["daily_return"].items():
        cur.execute(
            "INSERT INTO daily_returns (ticker, date, ret) VALUES (%s, %s, %s)"
            "ON CONFLICT (ticker, date) DO UPDATE SET ret = EXCLUDED.ret",
            (ticker, date_.date(), float(ret))
        )
    conn.commit()
    cur.close()
    conn.close()
    print(f"Ticker {ticker} loaded successfully.")

def fetch_returns_sync(tickers):
    conn = get_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    # Use a 5-year lookback window
    five_years_ago = date.today() - timedelta(days=5 * 365)

    query = """
        SELECT ticker, date, ret
        FROM daily_returns
        WHERE ticker = ANY(%s)
        AND date >= %s
        ORDER BY date
    """

    # Pass tickers as a single array parameter and the date as second param
    cur.execute(query, (tickers, five_years_ago))
    rows = cur.fetchall()

    cur.close()
    conn.close()
    return rows

def fetch_tickers(tickers):
    conn = get_connection()
    cur = conn.cursor(cursor_factory=psycopg2.extras.DictCursor)

    if tickers:
        query = """
            SELECT ticker, MIN(date), MAX(date)
            FROM daily_returns
            WHERE ticker = ANY(%s)
            GROUP BY ticker;
        """
        # Pass tickers as a single parameter (array) for ANY(%s)
        cur.execute(query, (tickers,))
    else:
        query = """
            SELECT ticker, MIN(date), MAX(date)
            FROM daily_returns
            GROUP BY ticker;
        """
        cur.execute(query)
    rows = cur.fetchall()

    cur.close()
    conn.close()
    return rows

# ---------------------------
# Portfolio Calculation
# ---------------------------

def compute_portfolio(rows, weights):
    df = pd.DataFrame(rows, columns=["ticker", "date", "ret"])
    df = df.pivot(index="date", columns="ticker", values="ret").fillna(0)

    w = pd.Series(weights)

    # Ensure all requested tickers exist as columns; if not, add them as zeros
    missing_tickers = []
    for ticker in w.index:
        if ticker not in df.columns:
            missing_tickers.append(ticker)
            df[ticker] = 0.0

    df["portfolio_ret"] = df[w.index].mul(w).sum(axis=1)
    df["cumulative"] = (1 + df["portfolio_ret"]).cumprod()

    return df["cumulative"], missing_tickers

# ---------------------------
# FastAPI App
# ---------------------------

app = FastAPI()


class Item(BaseModel):
    ticker: str
    weight: float


class PortfolioRequest(BaseModel):
    items: List[Item]


class TickersRequest(BaseModel):
    tickers: List[str]


class LoadDbRequest(BaseModel):
    tickers: List[str]
    start_date: date
    end_date: date


@app.post("/tickers")
async def get_tickers(req: TickersRequest):
    # Get list of tickers
    returned_tickers = await asyncio.to_thread(fetch_tickers, req.tickers)
    return {"status": "ok", "returned_tickers": returned_tickers}


@app.post("/tickers/ticker")
async def get_ticker_details(req: TickersRequest):
    # Get list of tickers details
    returned_tickers = await asyncio.to_thread(fetch_returns_sync, req.tickers)
    return {"status": "ok", "returned_tickers": returned_tickers}


@app.post("/load_db")
async def load_db(req: LoadDbRequest):
    # Run blocking DB work in a thread
    def run():
        for t in req.tickers:
            load_returns_to_db(t, req.start_date, req.end_date)

    await asyncio.to_thread(run)
    return {"status": "ok", "tickers_loaded": req.tickers}


@app.post("/portfolio/performance")
async def portfolio_performance(req: PortfolioRequest):
    start_time = datetime.now()
    tickers = [i.ticker for i in req.items]
    weights = {i.ticker: i.weight for i in req.items}

    # Run psycopg2 sync function in a thread
    rows = await asyncio.to_thread(fetch_returns_sync, tickers)

    perf, missing_tickers = compute_portfolio(rows, weights)

    calculation_time = datetime.now() - start_time
    print(f"Calculation time: {calculation_time}")

    return {
        "calculation_time": calculation_time,
        "missing_tickers": missing_tickers,
        "dates": perf.index.astype(str).tolist(),
        "values": perf.values.tolist(),
    }
