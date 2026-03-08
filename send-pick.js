/**
 * Oracle Buffet — Weekly Email
 * Pure Resend approach — no Cloudflare, no CLI tools needed
 *
 * TWO OPTIONS depending on your Resend plan:
 *
 * OPTION A: Resend + GitHub Actions (free, recommended)
 *   - GitHub runs this script on a cron schedule
 *   - Calls Claude, builds email, sends via Resend
 *   - Zero infrastructure, zero cost beyond API calls
 *
 * OPTION B: Just run it manually / call the function yourself
 *   - Paste ANTHROPIC_KEY and RESEND_KEY at the top
 *   - Run with: node send-pick.js
 *   - Or call sendWeeklyPick() from anywhere
 */

const ANTHROPIC_KEY = process.env.ANTHROPIC_KEY;
const RESEND_KEY    = process.env.RESEND_KEY;
const AV_KEY        = process.env.AV_KEY;       // optional
const TO_EMAIL      = process.env.TO_EMAIL;     // your email
const FROM_EMAIL    = process.env.FROM_EMAIL || 'Oracle Buffet <onboarding@resend.dev>'; // resend test domain works for personal use

/* ══════════════════════════════════════════════════════════
   1. GET THE PICK FROM CLAUDE
══════════════════════════════════════════════════════════ */
async function getBuffettPick() {
  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const prompt = `You are a Buffett-style value investing analyst for the Oracle Buffet weekly newsletter.

Today is ${today}.

Find THE single best "King of Undervalue" stock to dollar-cost average $8/day into this week.

Score candidates using this Buffett Value Score (max 100 pts):
- P/E: <10=15pts, <15=12pts, <20=8pts, <25=3pts
- P/B: <1.0=12pts, <1.5=10pts, <2.5=5pts, <4=2pts  
- ROE: ≥25%=18pts, ≥20%=15pts, ≥15%=10pts, ≥10%=4pts
- D/E: <0.3=15pts, <0.7=12pts, <1.0=7pts, <1.5=3pts
- Net Margin: ≥20%=15pts, ≥15%=12pts, ≥10%=8pts, ≥5%=4pts
- Earnings Growth: ≥15%=10pts, ≥8%=7pts, ≥0%=4pts, ≥-15%=2pts
- Dividend Yield: ≥3%=8pts, ≥1.5%=6pts, >0%=3pts
- EV/EBITDA: <8=7pts, <12=5pts, <16=2pts

Consider 5-8 candidates. Pick the single highest scorer with the best risk/reward.

Respond ONLY with valid JSON, no markdown fences:
{
  "ticker": "XXXX",
  "companyName": "Full Name",
  "sector": "Sector",
  "price": 00.00,
  "buffettScore": 00,
  "pe": 0.0, "pb": 0.0, "roe": 0.0, "de": 0.0,
  "netMargin": 0.0, "earningsGrowth": 0.0, "divYield": 0.0, "evEbitda": 0.0,
  "intrinsicValue": 0.00,
  "marginOfSafety": 0,
  "moatDescription": "one sentence on moat",
  "whyNow": "2-3 sentences on why this week specifically",
  "risks": "1-2 key risks",
  "thesis": "3-4 sentence investment thesis",
  "dailyDCANote": "one sentence on why $8/day DCA makes sense here",
  "candidates": [
    {"ticker": "AAA", "score": 00, "reason": "brief reason"},
    {"ticker": "BBB", "score": 00, "reason": "brief reason"},
    {"ticker": "CCC", "score": 00, "reason": "brief reason"}
  ],
  "weeklyQuote": "relevant Buffett or Munger quote"
}`;

  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': ANTHROPIC_KEY,
      'anthropic-version': '2023-06-01'
    },
    body: JSON.stringify({
      model: 'claude-sonnet-4-5',
      max_tokens: 1500,
      messages: [{ role: 'user', content: prompt }]
    })
  });

  const data = await res.json();
  if (data.error) throw new Error(`Claude API error: ${data.error.message}`);
  const text = data.content?.[0]?.text || '';
  return JSON.parse(text.replace(/```json|```/g, '').trim());
}

/* ══════════════════════════════════════════════════════════
   2. OPTIONAL: LIVE PRICE FROM ALPHA VANTAGE
══════════════════════════════════════════════════════════ */
async function getLivePrice(ticker) {
  if (!AV_KEY) return null;
  try {
    const res = await fetch(`https://www.alphavantage.co/query?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${AV_KEY}`);
    const data = await res.json();
    const q = data['Global Quote'];
    if (q?.['05. price']) {
      return {
        price: parseFloat(q['05. price']),
        change: parseFloat(q['09. change']),
        changePct: q['10. change percent']?.replace('%','') || '0'
      };
    }
  } catch(e) {}
  return null;
}

/* ══════════════════════════════════════════════════════════
   3. BUILD THE NEWSPAPER EMAIL HTML
══════════════════════════════════════════════════════════ */
function buildEmail(pick, liveQuote) {
  const price = liveQuote?.price || pick.price;
  const change = liveQuote?.change || 0;
  const changePct = liveQuote ? parseFloat(liveQuote.changePct).toFixed(2) : '0.00';
  const changeColor = change >= 0 ? '#2d6b2d' : '#8b1a1a';
  const changeSign = change >= 0 ? '+' : '';
  const isLive = !!liveQuote;
  const sharesPerWeek = (40 / price).toFixed(3);

  const today = new Date().toLocaleDateString('en-US', {
    weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
  });

  const scoreLabel = pick.buffettScore >= 80 ? 'BUFFETT GEM 💎'
    : pick.buffettScore >= 65 ? 'SOLID VALUE ✓'
    : pick.buffettScore >= 50 ? 'WATCH LIST 👁' : 'SPECULATIVE ⚠';

  const mRow = (label, val, unit, good) => `
    <tr>
      <td style="padding:6px 0;font-size:11px;color:#8b5e3c;font-family:'Courier New',monospace;border-bottom:1px solid #ede5d0">${label}</td>
      <td style="padding:6px 0;font-size:12px;font-weight:600;text-align:right;color:${good?'#1a1208':'#8b1a1a'};font-family:'Courier New',monospace;border-bottom:1px solid #ede5d0">${val}${unit}</td>
    </tr>`;

  const candidateRows = (pick.candidates || []).map(c => `
    <tr>
      <td style="padding:6px 8px;font-family:'Courier New',monospace;font-size:11px;font-weight:600;border-bottom:1px solid #2a2010">${c.ticker}</td>
      <td style="padding:6px 8px;font-family:'Courier New',monospace;font-size:12px;color:#c9a227;font-weight:700;border-bottom:1px solid #2a2010">${c.score}</td>
      <td style="padding:6px 8px;font-size:10px;color:rgba(245,240,232,0.6);border-bottom:1px solid #2a2010">${c.reason}</td>
    </tr>`).join('');

  return `<!DOCTYPE html>
<html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Oracle Buffet — ${pick.ticker} · ${today}</title></head>
<body style="margin:0;padding:0;background:#e8e0d0">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#e8e0d0;padding:20px 0">
<tr><td align="center">
<table width="620" cellpadding="0" cellspacing="0" style="background:#faf6ee;border:1px solid #c4b08a;border-radius:2px;overflow:hidden">

  <!-- MASTHEAD -->
  <tr><td style="background:#1a1208;border-bottom:4px solid #c9a227;padding:0">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="padding:18px 24px 10px">
        <div style="font-family:'Times New Roman',Times,serif;font-size:34px;font-weight:900;color:#c9a227;letter-spacing:-1px;line-height:1">⊕ Oracle Buffet</div>
        <div style="font-family:'Courier New',monospace;font-size:8px;color:rgba(245,240,232,0.35);letter-spacing:4px;text-transform:uppercase;margin-top:3px">Value Intelligence · Weekly Edition</div>
      </td>
      <td style="padding:18px 24px 10px;text-align:right;vertical-align:top">
        <div style="font-family:'Courier New',monospace;font-size:8px;color:rgba(245,240,232,0.35);letter-spacing:2px;text-transform:uppercase">${today}</div>
        <div style="font-family:'Courier New',monospace;font-size:8px;color:rgba(245,240,232,0.25);margin-top:3px">$8.00 / day DCA strategy</div>
      </td>
    </tr>
    <tr><td colspan="2" style="padding:0 24px 12px">
      <div style="border-top:1px solid rgba(201,162,39,0.25);padding-top:7px;font-family:'Courier New',monospace;font-size:7px;color:rgba(245,240,232,0.25);letter-spacing:3px;text-transform:uppercase">King of undervalue · Buffett score analysis · weekly DCA pick</div>
    </td></tr></table>
  </td></tr>

  <!-- HERO TICKER + SCORE -->
  <tr><td style="padding:24px 24px 0">
    <table width="100%" cellpadding="0" cellspacing="0"><tr valign="top">
      <td>
        <div style="font-family:'Courier New',monospace;font-size:9px;letter-spacing:3px;text-transform:uppercase;color:#8b5e3c;margin-bottom:5px">This Week's King of Undervalue</div>
        <div style="font-family:'Times New Roman',Times,serif;font-size:56px;font-weight:900;color:#1a1208;line-height:1;letter-spacing:-2px">${pick.ticker}</div>
        <div style="font-family:Georgia,serif;font-size:15px;color:#5a3e28;margin-top:3px;font-style:italic">${pick.companyName}</div>
        <div style="font-family:'Courier New',monospace;font-size:9px;color:#8b5e3c;margin-top:3px;text-transform:uppercase;letter-spacing:2px">${pick.sector}</div>
      </td>
      <td style="text-align:right">
        <table cellpadding="0" cellspacing="0" style="margin-left:auto">
          <tr><td align="center" style="background:#1a1208;border:3px solid #c9a227;border-radius:50%;width:88px;height:88px;vertical-align:middle">
            <div style="font-family:'Times New Roman',serif;font-size:28px;font-weight:900;color:#c9a227;line-height:1">${pick.buffettScore}</div>
            <div style="font-family:'Courier New',monospace;font-size:7px;color:rgba(201,162,39,0.6)">/100</div>
          </td></tr>
        </table>
        <div style="font-family:'Courier New',monospace;font-size:7px;color:#8b5e3c;letter-spacing:2px;text-transform:uppercase;margin-top:5px;text-align:center">Buffett Score</div>
        <div style="font-family:'Courier New',monospace;font-size:8px;font-weight:700;color:#c9a227;margin-top:2px;text-align:center">${scoreLabel}</div>
      </td>
    </tr></table>

    <!-- PRICE ROW -->
    <table width="100%" cellpadding="0" cellspacing="0" style="margin-top:16px;background:#1a1208;border-radius:3px">
      <tr><td style="padding:11px 14px">
        <table width="100%" cellpadding="0" cellspacing="0"><tr>
          <td>
            <span style="font-family:'Courier New',monospace;font-size:20px;font-weight:700;color:#faf6ee">$${Number(price).toFixed(2)}</span>
            <span style="font-family:'Courier New',monospace;font-size:11px;color:${changeColor};margin-left:8px">${changeSign}$${Math.abs(change).toFixed(2)} (${changeSign}${changePct}%)</span>
          </td>
          <td style="text-align:right">
            <span style="font-family:'Courier New',monospace;font-size:8px;color:${isLive?'#4caf50':'#8b5e3c'};letter-spacing:2px">${isLive?'⬤ LIVE':'● EST'}</span>
            <div style="font-family:'Courier New',monospace;font-size:8px;color:rgba(245,240,232,0.35);margin-top:2px">IV: $${Number(pick.intrinsicValue||0).toFixed(2)} · ${pick.marginOfSafety||0}% MOS</div>
          </td>
        </tr></table>
      </td></tr>
    </table>
  </td></tr>

  <!-- DCA BOX -->
  <tr><td style="padding:14px 24px 0">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fffbe8;border:1px solid #c9a227;border-left:4px solid #c9a227;border-radius:3px">
      <tr><td style="padding:13px 14px">
        <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:3px;text-transform:uppercase;color:#8b5e3c;margin-bottom:5px">💰 $8 / Day DCA Recommendation</div>
        <div style="font-family:Georgia,serif;font-size:12px;color:#1a1208;line-height:1.75">${pick.dailyDCANote}</div>
        <div style="font-family:'Courier New',monospace;font-size:9px;color:#8b5e3c;margin-top:7px">$8/day × 5 days = <strong style="color:#1a1208">$40/week</strong> &nbsp;·&nbsp; ~<strong style="color:#1a1208">${sharesPerWeek} shares/week</strong> at current price</div>
      </td></tr>
    </table>
  </td></tr>

  <!-- METRICS + THESIS -->
  <tr><td style="padding:18px 24px 0">
    <table width="100%" cellpadding="0" cellspacing="0"><tr valign="top">

      <!-- METRICS -->
      <td width="47%" style="padding-right:10px">
        <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:3px;text-transform:uppercase;color:#8b5e3c;border-bottom:2px solid #c9a227;padding-bottom:5px">Buffett Metrics</div>
        <table width="100%" cellpadding="0" cellspacing="0">
          ${mRow('P/E Ratio', (pick.pe||0).toFixed(1), 'x', (pick.pe||99)<20)}
          ${mRow('P/B Ratio', (pick.pb||0).toFixed(2), 'x', (pick.pb||99)<2.5)}
          ${mRow('ROE', (pick.roe||0).toFixed(1), '%', (pick.roe||0)>=15)}
          ${mRow('Debt / Equity', (pick.de||0).toFixed(2), 'x', (pick.de||99)<1.0)}
          ${mRow('Net Margin', (pick.netMargin||0).toFixed(1), '%', (pick.netMargin||0)>=10)}
          ${mRow('Earnings Growth', (pick.earningsGrowth||0).toFixed(1), '%', (pick.earningsGrowth||0)>=0)}
          ${mRow('Dividend Yield', (pick.divYield||0).toFixed(2), '%', (pick.divYield||0)>0)}
          ${mRow('EV / EBITDA', (pick.evEbitda||0).toFixed(1), 'x', (pick.evEbitda||99)<12)}
        </table>
        <div style="margin-top:10px;font-family:'Courier New',monospace;font-size:9px;color:#8b5e3c">
          Score&nbsp;<strong style="color:#c9a227">${pick.buffettScore}/100</strong>
          <div style="background:#e0d8c8;border-radius:2px;height:7px;margin-top:4px"><div style="background:#c9a227;height:7px;border-radius:2px;width:${Math.min(100,pick.buffettScore)}%"></div></div>
        </div>
      </td>

      <td width="6%" style="border-left:1px solid #e8e0d0"></td>

      <!-- THESIS -->
      <td width="47%" style="padding-left:10px">
        <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:3px;text-transform:uppercase;color:#8b5e3c;border-bottom:2px solid #c9a227;padding-bottom:5px;margin-bottom:10px">Investment Thesis</div>
        <div style="font-family:Georgia,serif;font-size:12px;color:#1a1208;line-height:1.8">${pick.thesis}</div>
        <div style="margin-top:12px;font-family:'Courier New',monospace;font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#8b5e3c;margin-bottom:5px">Economic Moat</div>
        <div style="font-family:Georgia,serif;font-size:11px;color:#1a1208;line-height:1.7;font-style:italic">${pick.moatDescription}</div>
        <div style="margin-top:12px;font-family:'Courier New',monospace;font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#8b5e3c;margin-bottom:5px">Why This Week</div>
        <div style="font-family:Georgia,serif;font-size:11px;color:#1a1208;line-height:1.7">${pick.whyNow}</div>
      </td>

    </tr></table>
  </td></tr>

  <!-- RISKS -->
  <tr><td style="padding:14px 24px 0">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#fff5f5;border:1px solid #e8c0c0;border-left:4px solid #8b1a1a;border-radius:3px">
      <tr><td style="padding:11px 14px">
        <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:2px;text-transform:uppercase;color:#8b1a1a;margin-bottom:5px">⚠ Key Risks</div>
        <div style="font-family:Georgia,serif;font-size:12px;color:#3a1a1a;line-height:1.7">${pick.risks}</div>
      </td></tr>
    </table>
  </td></tr>

  <!-- CANDIDATES -->
  <tr><td style="padding:18px 24px 0">
    <div style="font-family:'Courier New',monospace;font-size:8px;letter-spacing:3px;text-transform:uppercase;color:#8b5e3c;border-bottom:1px solid #c4b08a;padding-bottom:5px;margin-bottom:0">Other Candidates Considered</div>
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1208">
      <tr>
        <th style="padding:7px 8px;font-family:'Courier New',monospace;font-size:8px;color:rgba(201,162,39,0.7);text-align:left;letter-spacing:2px;font-weight:400;border-bottom:1px solid #2a2010">TICKER</th>
        <th style="padding:7px 8px;font-family:'Courier New',monospace;font-size:8px;color:rgba(201,162,39,0.7);text-align:left;letter-spacing:2px;font-weight:400;border-bottom:1px solid #2a2010">SCORE</th>
        <th style="padding:7px 8px;font-family:'Courier New',monospace;font-size:8px;color:rgba(201,162,39,0.7);text-align:left;letter-spacing:2px;font-weight:400;border-bottom:1px solid #2a2010">WHY CONSIDERED</th>
      </tr>
      ${candidateRows}
    </table>
  </td></tr>

  <!-- QUOTE -->
  <tr><td style="padding:18px 24px">
    <table width="100%" cellpadding="0" cellspacing="0" style="background:#1a1208;border-radius:3px">
      <tr><td style="padding:18px 22px;text-align:center">
        <div style="font-family:'Times New Roman',Times,serif;font-size:13px;color:rgba(245,240,232,0.82);line-height:1.9;font-style:italic">"${pick.weeklyQuote}"</div>
        <div style="font-family:'Courier New',monospace;font-size:8px;color:rgba(201,162,39,0.55);margin-top:8px;letter-spacing:2px">— WARREN BUFFETT · CHARLIE MUNGER</div>
      </td></tr>
    </table>
  </td></tr>

  <!-- FOOTER -->
  <tr><td style="background:#ede5d0;padding:12px 24px;border-top:2px solid #c4b08a">
    <table width="100%" cellpadding="0" cellspacing="0"><tr>
      <td style="font-family:'Courier New',monospace;font-size:7px;color:#8b5e3c;line-height:1.8">
        ⊕ Oracle Buffet · Value Intelligence Platform<br>
        AI-generated using Buffett value investing methodology. <strong>Not financial advice.</strong>
      </td>
      <td style="text-align:right;font-family:'Courier New',monospace;font-size:7px;color:#8b5e3c">
        $8/day · $40/week<br>Weekly DCA
      </td>
    </tr></table>
  </td></tr>

</table>
</td></tr></table>
</body></html>`;
}

/* ══════════════════════════════════════════════════════════
   4. SEND VIA RESEND
══════════════════════════════════════════════════════════ */
async function sendEmail(html, pick) {
  const dateStr = new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${RESEND_KEY}`
    },
    body: JSON.stringify({
      from: FROM_EMAIL,
      to: [TO_EMAIL],
      subject: `⊕ Oracle Buffet · ${pick.ticker} is this week's King of Undervalue · ${dateStr}`,
      html
    })
  });

  const data = await res.json();
  if (data.statusCode >= 400) throw new Error(`Resend error: ${JSON.stringify(data)}`);
  return data;
}

/* ══════════════════════════════════════════════════════════
   MAIN — run the whole pipeline
══════════════════════════════════════════════════════════ */
export async function sendWeeklyPick() {
  console.log('Oracle Buffet: Getting this week\'s pick from Claude...');
  const pick = await getBuffettPick();
  console.log(`Oracle Buffet: Pick → ${pick.ticker} (Buffett Score: ${pick.buffettScore})`);

  const liveQuote = await getLivePrice(pick.ticker);
  if (liveQuote) console.log(`Oracle Buffet: Live price → $${liveQuote.price}`);

  const html = buildEmail(pick, liveQuote);
  const result = await sendEmail(html, pick);
  console.log(`Oracle Buffet: Email sent! ID: ${result.id}`);
  return { ticker: pick.ticker, score: pick.buffettScore, emailId: result.id };
}

// Allow running directly with: node send-pick.js
if (typeof process !== 'undefined' && process.argv[1]?.includes('send-pick')) {
  sendWeeklyPick().catch(console.error);
}
