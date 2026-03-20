// Front-end logic for Portfolio Backtest Dashboard

let tickerChart = null;
let portfolioChart = null;

function qs(id) { return document.getElementById(id); }

function setTodayDefaults() {
  const today = new Date().toISOString().slice(0, 10);
  const oneYearAgo = new Date();
  oneYearAgo.setFullYear(oneYearAgo.getFullYear() - 1);
  const oneYearAgoStr = oneYearAgo.toISOString().slice(0, 10);
  qs('load-start-date').value = oneYearAgoStr;
  qs('load-end-date').value = today;
}

async function callJson(url, options) {
  const res = await fetch(url, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
  });
  if (!res.ok) {
    const txt = await res.text();
    throw new Error(`${res.status} ${res.statusText}: ${txt}`);
  }
  return res.json();
}

// ----- Tabs -----
function initTabs() {
  const tabs = document.querySelectorAll('.tab');
  tabs.forEach(tab => {
    tab.addEventListener('click', () => {
      tabs.forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      const tabName = tab.dataset.tab;
      qs('view-data').style.display = tabName === 'data' ? 'grid' : 'none';
      qs('view-portfolio').style.display = tabName === 'portfolio' ? 'grid' : 'none';
    });
  });
}

// ----- Tickers table -----
async function loadTickers() {
  const statusEl = qs('tickers-status');
  statusEl.textContent = 'Loading tickers…';
  try {
    const data = await callJson('/tickers', {
      method: 'POST',
      body: JSON.stringify({ tickers: [] }),
    });
    const rows = data.returned_tickers || [];
    const tbody = qs('tickers-table-body');
    tbody.innerHTML = '';
    rows.forEach(([ticker, minDate, maxDate]) => {
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td>${ticker}</td>
        <td>${minDate}</td>
        <td>${maxDate}</td>
      `;
      tr.addEventListener('click', () => {
        loadTickerHistory(ticker);
      });
      tbody.appendChild(tr);
    });
    statusEl.textContent = rows.length
      ? `Loaded ${rows.length} tickers from database.`
      : 'No tickers found in database.';
  } catch (e) {
    console.error(e);
    statusEl.textContent = 'Failed to load tickers: ' + e.message;
  }
}

// ----- Single ticker history -----
async function loadTickerHistory(ticker) {
  const statusEl = qs('ticker-history-status');
  statusEl.textContent = `Loading history for ${ticker}…`;
  try {
    const data = await callJson('/tickers/ticker', {
      method: 'POST',
      body: JSON.stringify({ tickers: [ticker] }),
    });
    const rows = data.returned_tickers || [];
    if (!rows.length) {
      statusEl.textContent = `No history found for ${ticker}.`;
      if (tickerChart) tickerChart.destroy();
      return;
    }
    // rows are [ticker, date, ret]
    const dates = [];
    const cumulative = [];
    let cum = 1.0;
    rows.forEach(([t, d, r]) => {
      dates.push(d);
      cum *= 1 + Number(r);
      cumulative.push(cum);
    });

    const ctx = qs('ticker-chart').getContext('2d');
    if (tickerChart) tickerChart.destroy();
    tickerChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dates,
        datasets: [{
          label: `${ticker} cumulative`,
          data: cumulative,
          borderColor: '#38bdf8',
          backgroundColor: 'rgba(56, 189, 248, 0.15)',
          tension: 0.22,
          borderWidth: 2,
          pointRadius: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            ticks: { color: '#9ca3af', maxTicksLimit: 6 },
            grid: { color: 'rgba(30, 64, 175, 0.4)' },
          },
          y: {
            ticks: { color: '#9ca3af' },
            grid: { color: 'rgba(30, 64, 175, 0.4)' },
          },
        },
        plugins: {
          legend: { labels: { color: '#e5e7eb' } },
          tooltip: {
            callbacks: {
              label: (ctx) => `Cumulative: ${ctx.parsed.y.toFixed(3)}`,
            },
          },
          zoom: {
            pan: { enabled: true, mode: 'x' },
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
          },
        },
      },
    });

    statusEl.textContent = `Loaded ${rows.length} points for ${ticker}. Scroll to zoom, drag to pan.`;
  } catch (e) {
    console.error(e);
    statusEl.textContent = 'Failed to load history: ' + e.message;
  }
}

// ----- Load data into DB -----
async function handleLoadDb() {
  const statusEl = qs('load-status');
  const tickersRaw = qs('load-tickers-input').value.trim();
  const startDate = qs('load-start-date').value;
  const endDate = qs('load-end-date').value;

  if (!tickersRaw || !startDate || !endDate) {
    statusEl.textContent = 'Please provide tickers, start date, and end date.';
    statusEl.classList.add('status-bad');
    return;
  }
  statusEl.classList.remove('status-bad');

  const tickers = tickersRaw.split(',').map(t => t.trim()).filter(Boolean);
  if (!tickers.length) {
    statusEl.textContent = 'Please enter at least one ticker.';
    statusEl.classList.add('status-bad');
    return;
  }

  statusEl.textContent = `Loading data for ${tickers.join(', ')}…`;

  try {
    const data = await callJson('/load_db', {
      method: 'POST',
      body: JSON.stringify({ tickers, start_date: startDate, end_date: endDate }),
    });
    statusEl.textContent = `Loaded tickers: ${(data.tickers_loaded || []).join(', ')}.`;
    loadTickers();
  } catch (e) {
    console.error(e);
    statusEl.textContent = 'Failed to load data: ' + e.message;
    statusEl.classList.add('status-bad');
  }
}

// ----- Portfolio definition UI -----
function addPortfolioRow(ticker = '', weight = '') {
  const container = qs('portfolio-rows');
  const row = document.createElement('div');
  row.className = 'portfolio-row';
  row.innerHTML = `
    <input type="text" placeholder="Ticker" value="${ticker}" />
    <input type="number" placeholder="Weight" step="0.01" value="${weight}" />
    <button class="btn-secondary" type="button">✕</button>
  `;
  const removeBtn = row.querySelector('button');
  removeBtn.addEventListener('click', () => {
    container.removeChild(row);
  });
  container.appendChild(row);
}

async function runBacktest() {
  const statusEl = qs('portfolio-status');
  const missingEl = qs('portfolio-missing');
  const missingList = qs('portfolio-missing-list');
  missingEl.textContent = '';
  missingList.innerHTML = '';

  const rows = Array.from(qs('portfolio-rows').children);
  const items = [];
  rows.forEach(row => {
    const [tickerInput, weightInput] = row.querySelectorAll('input');
    const t = tickerInput.value.trim();
    const w = parseFloat(weightInput.value);
    if (t && !isNaN(w)) {
      items.push({ ticker: t, weight: w });
    }
  });

  if (!items.length) {
    statusEl.textContent = 'Please add at least one (ticker, weight) pair.';
    statusEl.classList.add('status-bad');
    return;
  }
  statusEl.classList.remove('status-bad');

  const weightSum = items.reduce((s, i) => s + i.weight, 0);
  if (Math.abs(weightSum - 1) > 0.001) {
    statusEl.textContent = `Warning: weights sum to ${weightSum.toFixed(3)}, not 1.0.`;
  } else {
    statusEl.textContent = 'Running backtest…';
  }

  try {
    const data = await callJson('/portfolio/performance', {
      method: 'POST',
      body: JSON.stringify({ items }),
    });

    const dates = data.dates || [];
    const values = data.values || [];
    const missingTickers = data.missing_tickers || [];

    const ctx = qs('portfolio-chart').getContext('2d');
    if (portfolioChart) portfolioChart.destroy();
    portfolioChart = new Chart(ctx, {
      type: 'line',
      data: {
        labels: dates,
        datasets: [{
          label: 'Portfolio cumulative',
          data: values,
          borderColor: '#22c55e',
          backgroundColor: 'rgba(34, 197, 94, 0.15)',
          borderWidth: 2,
          tension: 0.22,
          pointRadius: 0,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            ticks: { color: '#9ca3af', maxTicksLimit: 6 },
            grid: { color: 'rgba(30, 64, 175, 0.4)' },
          },
          y: {
            ticks: { color: '#9ca3af' },
            grid: { color: 'rgba(30, 64, 175, 0.4)' },
          },
        },
        plugins: {
          legend: { labels: { color: '#e5e7eb' } },
          tooltip: {
            callbacks: {
              label: (ctx) => `Value: ${ctx.parsed.y.toFixed(3)}`,
            },
          },
          zoom: {
            pan: { enabled: true, mode: 'x' },
            zoom: { wheel: { enabled: true }, pinch: { enabled: true }, mode: 'x' },
          },
        },
      },
    });

    statusEl.textContent = `Backtest complete in ${data.calculation_time || 'n/a'}. Scroll to zoom, drag to pan.`;

    if (missingTickers.length) {
      missingEl.textContent = 'Tickers with no data (treated as 0 return):';
      missingTickers.forEach(t => {
        const pill = document.createElement('div');
        pill.className = 'pill';
        pill.textContent = t;
        missingList.appendChild(pill);
      });
    } else {
      missingEl.textContent = 'All requested tickers had data in the database.';
    }
  } catch (e) {
    console.error(e);
    statusEl.textContent = 'Failed to run backtest: ' + e.message;
    statusEl.classList.add('status-bad');
  }
}

function initPortfolioUI() {
  qs('btn-add-row').addEventListener('click', () => addPortfolioRow());
  qs('btn-run-backtest').addEventListener('click', runBacktest);
  // Start with two example rows
  addPortfolioRow('AAPL', '0.5');
  addPortfolioRow('MSFT', '0.5');
}

// ----- Init -----
window.addEventListener('DOMContentLoaded', () => {
  initTabs();
  setTodayDefaults();
  qs('btn-refresh-tickers').addEventListener('click', loadTickers);
  qs('btn-load-db').addEventListener('click', handleLoadDb);
  initPortfolioUI();
  loadTickers();
});
