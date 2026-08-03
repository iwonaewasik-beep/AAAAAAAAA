// GenAI Finance course, starter scaffold.
// This file intentionally does very little. Build on it during class.
//
// No API keys are stored in this file. Both the Twelve Data key and the
// OpenRouter key are entered in the form fields at run time, so nothing secret
// is ever committed to your public repo or shipped in the source.

const form = document.getElementById('ticker-form');
const results = document.getElementById('results');

form.addEventListener('submit', async (event) => {
  event.preventDefault();

  const ticker = document.getElementById('ticker').value.trim().toUpperCase();
  const twelveDataKey = document.getElementById('twelvedata-key').value.trim();
  const openRouterKey = document.getElementById('openrouter-key').value.trim();

  results.innerHTML = '<p>Loading...</p>';

  try {
    const priceData = await fetchPriceData(ticker, twelveDataKey);
    const rsiData = calculateRSI(priceData, 14);
    const macdData = calculateMACD(priceData, 12, 26, 9);
    const note = await getResearchNote(ticker, priceData, rsiData, macdData, openRouterKey);
    renderResults(ticker, priceData, rsiData, macdData, note);
  } catch (err) {
    results.innerHTML = `<p class="error">Something went wrong: ${err.message}</p>`;
  }
});

// Calculate 14-period RSI
function calculateRSI(priceData, period = 14) {
  if (!priceData || priceData.length <= period) return null;

  const closes = priceData.map((p) => p.close);
  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const diff = closes[i] - closes[i - 1];
    if (diff >= 0) gains += diff;
    else losses += Math.abs(diff);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  const rsiValues = [];
  let rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  let rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);
  rsiValues.push({ date: priceData[period].date, rsi });

  for (let i = period + 1; i < closes.length; i++) {
    const diff = closes[i] - closes[i - 1];
    const gain = diff >= 0 ? diff : 0;
    const loss = diff < 0 ? Math.abs(diff) : 0;

    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;

    rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
    rsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs);

    rsiValues.push({ date: priceData[i].date, rsi });
  }

  return rsiValues;
}

// Helper to compute Exponential Moving Average (EMA)
function calculateEMA(dataValues, period) {
  if (dataValues.length < period) return [];

  const k = 2 / (period + 1);
  let sum = 0;
  for (let i = 0; i < period; i++) {
    sum += dataValues[i];
  }
  let ema = sum / period;

  const emaSeries = [{ index: period - 1, ema }];

  for (let i = period; i < dataValues.length; i++) {
    ema = dataValues[i] * k + ema * (1 - k);
    emaSeries.push({ index: i, ema });
  }

  return emaSeries;
}

// Calculate MACD (12, 26, 9)
function calculateMACD(priceData, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  if (!priceData || priceData.length < slowPeriod + signalPeriod) return null;

  const closes = priceData.map((p) => p.close);

  const emaFast = calculateEMA(closes, fastPeriod);
  const emaSlow = calculateEMA(closes, slowPeriod);

  const fastMap = new Map(emaFast.map((item) => [item.index, item.ema]));

  const macdLine = [];
  for (const slowItem of emaSlow) {
    const idx = slowItem.index;
    const fastEma = fastMap.get(idx);
    if (fastEma !== undefined) {
      macdLine.push({ index: idx, date: priceData[idx].date, macd: fastEma - slowItem.ema });
    }
  }

  const macdValues = macdLine.map((m) => m.macd);
  const signalEma = calculateEMA(macdValues, signalPeriod);

  const result = [];
  for (const sig of signalEma) {
    const macdItem = macdLine[sig.index];
    const macd = macdItem.macd;
    const signal = sig.ema;
    const histogram = macd - signal;
    result.push({
      date: macdItem.date,
      macd,
      signal,
      histogram
    });
  }

  return result;
}

// Twelve Data daily price history.
// This endpoint sends CORS headers, so it works directly from the browser.
// The free plan covers all US equities and ETFs (no ticker whitelist).
// Returns an array of daily bars sorted oldest to newest, each shaped as
// { date, open, high, low, close, volume } with numeric values.
// Replace or extend with moving average, MACD, RSI calculations from Day 1.
async function fetchPriceData(ticker, apiKey) {
  // outputsize is the number of most-recent bars. ~63 trading days is about
  // 3 months; 90 leaves a little headroom. Max allowed is 5000.
  const url = `https://api.twelvedata.com/time_series?symbol=${ticker}&interval=1day&outputsize=90&apikey=${apiKey}`;
  const response = await fetch(url);

  // Read the body as text first, then parse it safely, so an unexpected
  // non-JSON response gives a readable error instead of "Unexpected token".
  const body = await response.text();
  let raw;
  try {
    raw = JSON.parse(body);
  } catch {
    throw new Error(body.trim() || 'Price fetch failed');
  }

  // Twelve Data reports problems as { code, status: "error", message }.
  if (raw && raw.status === 'error') throw new Error(raw.message || 'Price fetch failed');
  if (!response.ok) throw new Error('Price fetch failed');

  // Successful responses look like { meta, values: [ { datetime, open, ... } ] },
  // newest first. Normalize to numbers and sort oldest to newest so indicator
  // math (moving averages, RSI, ...) reads left to right.
  const values = raw.values ?? [];
  if (!values.length) throw new Error(`No price data returned for ${ticker}`);

  return values
    .map((b) => ({
      date: b.datetime,
      open: Number(b.open),
      high: Number(b.high),
      low: Number(b.low),
      close: Number(b.close),
      volume: Number(b.volume)
    }))
    .sort((a, b) => (a.date < b.date ? -1 : 1));
}

// OpenRouter call. The price data above is summarized and handed to the model
// so the note reflects the actual numbers you fetched. Replace the model,
// prompt, and system prompt with whatever you designed in the Prompt
// Engineering session.
async function getResearchNote(ticker, priceData, rsiData, macdData, apiKey) {
  const first = priceData[0];
  const latest = priceData[priceData.length - 1];
  const pctChange = ((latest.close - first.close) / first.close) * 100;

  const latestRSI = rsiData && rsiData.length ? rsiData[rsiData.length - 1].rsi : null;
  const latestMACD = macdData && macdData.length ? macdData[macdData.length - 1] : null;

  const rsiSummary = latestRSI !== null ? `14-day RSI: ${latestRSI.toFixed(2)}.` : '';
  const macdSummary =
    latestMACD !== null
      ? `MACD (12,26,9): Line ${latestMACD.macd.toFixed(2)}, Signal ${latestMACD.signal.toFixed(2)}, Histogram ${latestMACD.histogram.toFixed(2)}.`
      : '';

  const summary =
    `${ticker} daily closes from ${first.date} to ${latest.date}: ` +
    `start $${first.close.toFixed(2)}, latest $${latest.close.toFixed(2)}, ` +
    `change ${pctChange.toFixed(1)}% over ${priceData.length} trading days. ` +
    `${rsiSummary} ${macdSummary}`;

  const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      model: 'anthropic/claude-sonnet-5',
      max_tokens: 2000,
      reasoning: { enabled: false },
      messages: [
        { role: 'system', content: 'You are a financial research assistant. Be concise and factual.' },
        {
          role: 'user',
          content: `${summary}\n\nWrite a one paragraph research note for ${ticker} based on this price action and technical indicators (RSI & MACD).`
        }
      ]
    })
  });
  if (!response.ok) throw new Error(`OpenRouter call failed. ${await readOpenRouterError(response)}`);
  const data = await response.json();
  return data.choices?.[0]?.message?.content ?? 'No response.';
}

// Pulls the useful part out of an OpenRouter error response
async function readOpenRouterError(response) {
  let message = '';
  try {
    const body = await response.json();
    const err = body.error ?? body;
    message = err.message || '';
    const provider = err.metadata?.provider_name;
    const raw = err.metadata?.raw;
    if (provider) message += ` [provider: ${provider}]`;
    if (raw) message += ` ${typeof raw === 'string' ? raw : JSON.stringify(raw)}`;
  } catch {
    // Response body was not JSON
  }
  const hint = {
    401: 'Your API key looks invalid or missing',
    402: 'This model is paid and your OpenRouter account is out of credits',
    429: 'Rate limited, wait a moment and try again'
  }[response.status];
  return [`(HTTP ${response.status})`, hint, message].filter(Boolean).join(' ');
}

function renderResults(ticker, priceData, rsiData, macdData, note) {
  const latest = priceData[priceData.length - 1];
  const latestRSI = rsiData && rsiData.length ? rsiData[rsiData.length - 1].rsi : null;
  const latestMACD = macdData && macdData.length ? macdData[macdData.length - 1] : null;

  let rsiHtml = '<p class="placeholder">Insufficient data for RSI calculation.</p>';
  if (latestRSI !== null) {
    let statusClass = 'neutral';
    let statusText = 'Neutral';
    if (latestRSI >= 70) {
      statusClass = 'overbought';
      statusText = 'Overbought (>70)';
    } else if (latestRSI <= 30) {
      statusClass = 'oversold';
      statusText = 'Oversold (<30)';
    }
    rsiHtml = `
      <div class="indicator-header">
        <span class="indicator-title">RSI (14)</span>
        <span class="badge badge-${statusClass}">${statusText}</span>
      </div>
      <div class="indicator-value">${latestRSI.toFixed(2)}</div>
    `;
  }

  let macdHtml = '<p class="placeholder">Insufficient data for MACD calculation.</p>';
  if (latestMACD !== null) {
    let macdStatusClass = 'neutral';
    let macdStatusText = 'Neutral';
    if (latestMACD.histogram > 0) {
      macdStatusClass = 'bullish';
      macdStatusText = 'Bullish Momentum';
    } else if (latestMACD.histogram < 0) {
      macdStatusClass = 'bearish';
      macdStatusText = 'Bearish Momentum';
    }

    macdHtml = `
      <div class="indicator-header">
        <span class="indicator-title">MACD (12, 26, 9)</span>
        <span class="badge badge-${macdStatusClass}">${macdStatusText}</span>
      </div>
      <div class="indicator-details">
        <div class="stat-row"><span>MACD Line:</span> <strong>${latestMACD.macd.toFixed(2)}</strong></div>
        <div class="stat-row"><span>Signal Line:</span> <strong>${latestMACD.signal.toFixed(2)}</strong></div>
        <div class="stat-row"><span>Histogram:</span> <strong class="${latestMACD.histogram >= 0 ? 'text-green' : 'text-red'}">${latestMACD.histogram.toFixed(2)}</strong></div>
      </div>
    `;
  }

  results.innerHTML = `
    <h2>${ticker}</h2>
    <p class="price">Latest close (${latest.date}): $${latest.close.toFixed(2)}</p>

    <div class="indicators-grid">
      <div class="indicator-card">${rsiHtml}</div>
      <div class="indicator-card">${macdHtml}</div>
    </div>

    <div class="note-box">
      <h3>AI Research Note</h3>
      <p class="note">${note}</p>
    </div>
  `;
}
