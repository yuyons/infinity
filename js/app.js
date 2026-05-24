// app.js - UI bindings & state management
// 새 엔진(calcInfinity) 기반

const App = (() => {
  let currentTicker = 'TQQQ';
  let currentTab = 'dashboard';
  let tradeContext = null;

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(t._timer);
    t._timer = setTimeout(() => t.classList.remove('show'), 2400);
  }

  function fmt(n, d = 2) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Number(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  }
  function fmtInt(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    return Math.round(Number(n)).toLocaleString('en-US');
  }
  function fmtPct(n) {
    if (n === null || n === undefined || isNaN(n)) return '—';
    const v = Number(n);
    const sign = v > 0 ? '+' : '';
    return `${sign}${v.toFixed(2)}%`;
  }

  // ===== Ticker color =====
  function applyTickerColor(color) {
    document.body.style.setProperty('--accent', color);
    document.body.style.setProperty('--accent-soft', hexToSoft(color));
    document.body.style.setProperty('--accent-on', '#ffffff');
  }
  function hexToSoft(hex) {
    const m = hex.match(/^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i);
    if (!m) return '#dbeafe';
    const r = parseInt(m[1], 16), g = parseInt(m[2], 16), b = parseInt(m[3], 16);
    const mix = (c) => Math.round(c * 0.15 + 255 * 0.85);
    return `rgb(${mix(r)}, ${mix(g)}, ${mix(b)})`;
  }

  // ===== Ticker switch =====
  async function renderTickerSwitch() {
    const tickers = await DB.getTickers();
    const wrap = $('#tickerSwitch');
    wrap.innerHTML = tickers.map(t => `
      <button class="ticker-btn ${t.symbol === currentTicker ? 'active' : ''}"
              data-ticker="${t.symbol}"
              style="${t.symbol === currentTicker ? `background:${t.color};color:#fff;` : ''}">${t.symbol}</button>
    `).join('');
    if (!tickers.find(t => t.symbol === currentTicker)) {
      currentTicker = tickers[0] ? tickers[0].symbol : 'TQQQ';
      await DB.setApp('currentTicker', currentTicker);
      return renderTickerSwitch();
    }
    const cur = tickers.find(t => t.symbol === currentTicker);
    if (cur) applyTickerColor(cur.color);
    wrap.querySelectorAll('.ticker-btn').forEach(btn => {
      btn.addEventListener('click', async () => {
        currentTicker = btn.dataset.ticker;
        await DB.setApp('currentTicker', currentTicker);
        await renderTickerSwitch();
        await loadConfigsToUI();
        await refreshAll();
      });
    });
  }

  function bindHeader() {
    $$('.tab').forEach(t => {
      t.addEventListener('click', () => {
        currentTab = t.dataset.tab;
        $$('.tab').forEach(b => b.classList.toggle('active', b === t));
        $$('.page').forEach(p => p.classList.remove('active'));
        $(`#page-${currentTab}`).classList.add('active');
      });
    });
  }

  // ===== Hero / Price =====
  function bindHero() {
    $('#todayPrice').addEventListener('input', async (e) => {
      const v = parseFloat(e.target.value);
      await DB.setApp(`todayPrice:${currentTicker}`, isNaN(v) ? null : v);
      setPriceMeta('', null);
      await refreshAll();
    });
    $('#fetchPriceBtn').addEventListener('click', autoFetchPrice);
  }
  async function getTodayPrice() {
    const v = await DB.getApp(`todayPrice:${currentTicker}`);
    return v ? Number(v) : null;
  }

  // ===== Finnhub =====
  async function fetchFinnhubQuote(symbol, apiKey) {
    const url = `https://finnhub.io/api/v1/quote?symbol=${encodeURIComponent(symbol)}&token=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url);
    if (!res.ok) {
      if (res.status === 401) throw new Error('API 키가 올바르지 않습니다');
      if (res.status === 429) throw new Error('요청 한도 초과 (분당 60회). 잠시 후 재시도');
      throw new Error(`HTTP ${res.status}`);
    }
    const data = await res.json();
    if (!data || typeof data.c !== 'number' || data.c === 0) {
      throw new Error('시세 데이터 없음 (장 시작 전이거나 종목 코드 오류)');
    }
    return {
      current: data.c, change: data.d, changePct: data.dp,
      high: data.h, low: data.l, open: data.o, prevClose: data.pc,
      timestamp: data.t * 1000,
    };
  }
  function setPriceMeta(text, status) {
    const meta = $('#priceMeta');
    if (!meta) return;
    meta.textContent = text || '';
    meta.classList.remove('error', 'ok');
    if (status) meta.classList.add(status);
  }
  async function autoFetchPrice() {
    const apiKey = await DB.getApp('finnhubKey');
    if (!apiKey) {
      setPriceMeta('설정 탭에서 Finnhub API 키를 먼저 등록하세요', 'error');
      toast('API 키 미등록');
      return;
    }
    const btn = $('#fetchPriceBtn');
    btn.classList.add('loading');
    setPriceMeta('조회 중...', null);
    try {
      const q = await fetchFinnhubQuote(currentTicker, apiKey);
      $('#todayPrice').value = q.current.toFixed(2);
      await DB.setApp(`todayPrice:${currentTicker}`, q.current);
      const localTime = new Date(q.timestamp).toLocaleString('ko-KR', {
        month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
      });
      const sign = q.changePct >= 0 ? '+' : '';
      setPriceMeta(`${localTime} · ${sign}${q.changePct.toFixed(2)}% · 전일종가 $${q.prevClose.toFixed(2)}`, 'ok');
      await refreshAll();
    } catch (err) {
      setPriceMeta(err.message, 'error');
      toast('조회 실패');
    } finally {
      btn.classList.remove('loading');
    }
  }

  // ===== Config save =====
  function bindConfigSave() {
    $('#m40Save').addEventListener('click', async () => {
      const seed = +$('#m40Seed').value || 0;
      const perRound = +$('#m40PerRound').value || 0;
      const cfg = {
        seed,
        perRoundBaseAmt: perRound > 0 ? perRound : (seed > 0 ? seed/40 : 0),
      };
      await DB.setConfig(currentTicker, 'm40', cfg);
      toast('40무매 저장됨');
      await refreshAll();
    });
    $('#m20Save').addEventListener('click', async () => {
      const seed = +$('#m20Seed').value || 0;
      const perRound = +$('#m20PerRound').value || 0;
      const cfg = {
        seed,
        perRoundBaseAmt: perRound > 0 ? perRound : (seed > 0 ? seed/20 : 0),
      };
      await DB.setConfig(currentTicker, 'm20', cfg);
      toast('20무매 저장됨');
      await refreshAll();
    });
    $('#vrSave').addEventListener('click', async () => {
      const cfg = {
        V0: +$('#vrV0').value || 0,
        startDate: $('#vrStartDate').value || '',
        monthly: +$('#vrMonthly').value || 0,
        G: +$('#vrG').value || 10,
        qty: +$('#vrQty').value || 0,
        pool: +$('#vrPool').value || 0,
        upper: +$('#vrUpper').value || 120,
        lower: +$('#vrLower').value || 80,
      };
      await DB.setConfig(currentTicker, 'vr', cfg);
      toast('VR 저장됨');
      await refreshAll();
    });
  }

  // ===== Load configs =====
  async function loadConfigsToUI() {
    const m40 = await DB.getConfig(currentTicker, 'm40') || {};
    $('#m40Seed').value = m40.seed || '';
    $('#m40PerRound').value = m40.perRoundBaseAmt || '';

    const m20 = await DB.getConfig(currentTicker, 'm20') || {};
    $('#m20Seed').value = m20.seed || '';
    $('#m20PerRound').value = m20.perRoundBaseAmt || '';

    const vr = await DB.getConfig(currentTicker, 'vr') || {};
    $('#vrV0').value = vr.V0 || '';
    $('#vrStartDate').value = vr.startDate || '';
    $('#vrMonthly').value = vr.monthly || '';
    $('#vrG').value = vr.G || '';
    $('#vrQty').value = vr.qty || '';
    $('#vrPool').value = vr.pool || '';
    $('#vrUpper').value = vr.upper || 120;
    $('#vrLower').value = vr.lower || 80;

    const price = await getTodayPrice();
    $('#todayPrice').value = price || '';
    $('#heroTicker').textContent = currentTicker;

    const finnhubKey = await DB.getApp('finnhubKey');
    if (finnhubKey) $('#finnhubKey').value = finnhubKey;
  }

  // ===== Action / Mode labels =====
  function modeLabel(mode) {
    return mode === 'QUARTER_LOSS' ? '쿼터손절 모드' : '정상 모드';
  }
  function halfLabel(half) {
    return half === 'first' ? '전반전' : '후반전';
  }

  // ===== 매수/매도 호가 렌더 =====
  function renderOrders(orders, type) {
    if (!orders || orders.length === 0) {
      return `<div class="result-empty">${type === 'buy' ? '매수' : '매도'} 호가 없음</div>`;
    }
    return orders.map(o => {
      const pnlHtml = (o.pnl !== undefined && o.pnl !== null)
        ? ` / <span class="${o.pnl >= 0 ? 'buy' : 'sell'}">손익 ${o.pnl >= 0 ? '+' : '−'}$${fmt(Math.abs(o.pnl))}</span>`
        : '';
      return `
        <div class="order-row">
          <div class="kind">${o.label}</div>
          <div class="price">$${fmt(o.price)}</div>
          <div class="qty-amt"><b>${fmtInt(o.qty)}</b>주 / $<b>${fmt(o.amt)}</b>${pnlHtml}</div>
        </div>
      `;
    }).join('');
  }

  // ===== 결과 카드 렌더 (40무매 / 20무매 공통) =====
  function renderInfinityResult(boxId, r, strategyName) {
    const box = $(`#${boxId}`);
    if (!r) {
      box.innerHTML = `<h3>오늘의 계산</h3><div class="result-empty">시드와 종가를 입력하면 계산됩니다</div>`;
      return;
    }
    const quarterWarn = r.quarterZone && r.mode !== 'QUARTER_LOSS'
      ? `<div class="signal-item sell" style="margin-bottom:10px;"><div><div class="strategy">경고</div><div class="label">T=${r.T}로 쿼터손절 구간 진입 (${r.strategy === 'm40' ? '39<T≤40' : '19<T≤20'})</div></div></div>`
      : '';

    box.innerHTML = `
      <h3>${strategyName} · T=${r.T} · ★%=${fmtPct(r.starPct)} · ${halfLabel(r.half)}</h3>
      ${quarterWarn}
      <div class="result-grid">
        <div class="result-item">
          <div class="k">평단</div>
          <div class="v">$${r.avgPrice > 0 ? fmt(r.avgPrice) : '—'}</div>
        </div>
        <div class="result-item">
          <div class="k">보유수량</div>
          <div class="v">${fmtInt(r.qty)} 주</div>
        </div>
        <div class="result-item">
          <div class="k">평가금</div>
          <div class="v">$${fmt(r.evalAmt)}</div>
        </div>
        <div class="result-item">
          <div class="k">수익률</div>
          <div class="v">${fmtPct(r.profitRate)}</div>
        </div>
        <div class="result-item">
          <div class="k">1회매수액</div>
          <div class="v">$${fmt(r.perRound)}</div>
        </div>
        <div class="result-item">
          <div class="k">매수누적</div>
          <div class="v">$${fmt(r.buyAccum)}</div>
        </div>
      </div>

      <div class="order-block">
        <div class="order-block-title buy">매수 주문 (${r.mode === 'QUARTER_LOSS' ? '쿼터손절: -12% LOC' : (r.half === 'first' ? '전반전: 0%LOC + ★%LOC 절반씩' : '후반전: ★%LOC 전체')})</div>
        ${renderOrders(r.buyOrders, 'buy')}
      </div>
      <div class="order-block">
        <div class="order-block-title sell">매도 주문 (보유 ${fmtInt(r.qty)}주)</div>
        ${renderOrders(r.sellOrders, 'sell')}
      </div>

      ${r.prevCyclesRealized !== 0 ? `
      <div class="result-item full" style="margin-top:10px;">
        <div class="k">이전 사이클 실현수익 (반복리 기준)</div>
        <div class="v ${r.prevCyclesRealized >= 0 ? 'buy' : 'sell'}">${r.prevCyclesRealized >= 0 ? '+' : '−'}$${fmt(Math.abs(r.prevCyclesRealized))}</div>
      </div>` : ''}
    `;
  }

  // ===== VR 결과 (그대로) =====
  function renderResultVR(result) {
    const box = $('#vrResult');
    if (!result) {
      box.innerHTML = `<h3>VR 현황</h3><div class="result-empty">파라미터와 종가를 입력하면 V·평가금·신호가 계산됩니다</div>`;
      return;
    }
    const sig = result.signal;
    const cls = sig === 'BUY' ? 'buy' : sig === 'SELL' ? 'sell' : 'hold';
    const lbl = sig === 'BUY' ? '매수' : sig === 'SELL' ? '매도' : '관망';
    box.innerHTML = `
      <h3>VR 현황</h3>
      <div class="result-grid">
        <div class="result-item full">
          <div class="k">신호 / ${result.note}</div>
          <div class="v ${cls}">${lbl}</div>
        </div>
        <div class="result-item">
          <div class="k">V (목표값)</div>
          <div class="v">$${fmt(result.V)}</div>
        </div>
        <div class="result-item">
          <div class="k">E (평가금)</div>
          <div class="v">$${fmt(result.E)}</div>
        </div>
        <div class="result-item">
          <div class="k">상단선</div>
          <div class="v">$${fmt(result.upperLine)}</div>
        </div>
        <div class="result-item">
          <div class="k">하단선</div>
          <div class="v">$${fmt(result.lowerLine)}</div>
        </div>
        <div class="result-item">
          <div class="k">총자산</div>
          <div class="v">$${fmt(result.totalEquity)}</div>
        </div>
        <div class="result-item">
          <div class="k">경과일</div>
          <div class="v">${result.daysElapsed} 일</div>
        </div>
        ${result.signal !== 'HOLD' ? `
        <div class="result-item full">
          <div class="k">권장 ${lbl} 수량</div>
          <div class="v ${cls}">${fmtInt(result.shares)} 주 (~$${fmt(result.amount)})</div>
        </div>` : ''}
      </div>
    `;
  }

  // ===== Dashboard =====
  function renderDashboard(r40, r20, rVR) {
    $('#heroTicker').textContent = currentTicker;
    if (r40) {
      $('#d40Round').textContent = `T=${r40.T}`;
      $('#d40Sub').textContent = `${halfLabel(r40.half)} · ★%=${fmtPct(r40.starPct)} · $${fmt(r40.evalAmt)}`;
    } else {
      $('#d40Round').textContent = '—';
      $('#d40Sub').textContent = '설정 필요';
    }
    if (r20) {
      $('#d20Round').textContent = `T=${r20.T}`;
      $('#d20Sub').textContent = `${halfLabel(r20.half)} · ★%=${fmtPct(r20.starPct)} · $${fmt(r20.evalAmt)}`;
    } else {
      $('#d20Round').textContent = '—';
      $('#d20Sub').textContent = '설정 필요';
    }
    if (rVR) {
      const lbl = rVR.signal === 'BUY' ? '매수' : rVR.signal === 'SELL' ? '매도' : '관망';
      const cls = rVR.signal === 'BUY' ? 'buy' : rVR.signal === 'SELL' ? 'sell' : 'hold';
      $('#dVrSignal').textContent = lbl;
      $('#dVrSignal').className = `stat-value ${cls}`;
      $('#dVrSub').textContent = `V $${fmt(rVR.V)} · E $${fmt(rVR.E)}`;
    } else {
      $('#dVrSignal').textContent = '—';
      $('#dVrSignal').className = 'stat-value';
      $('#dVrSub').textContent = '설정 필요';
    }

    // 신호 리스트 (대시보드)
    const list = $('#signalList');
    const items = [];
    if (r40 && r40.buyOrders.length > 0) {
      const top = r40.buyOrders[0];
      items.push({ strategy: '40무매 V2.2', action: 'BUY', label: top.label, qty: top.qty, price: top.price });
    }
    if (r20 && r20.buyOrders.length > 0) {
      const top = r20.buyOrders[0];
      items.push({ strategy: '20무매 V3.0', action: 'BUY', label: top.label, qty: top.qty, price: top.price });
    }
    if (rVR && rVR.signal !== 'HOLD') {
      const cls = rVR.signal === 'BUY' ? 'buy' : 'sell';
      items.push({ strategy: 'VR', action: rVR.signal, label: rVR.note, qty: rVR.shares, price: null, _cls: cls });
    }
    if (items.length === 0) {
      list.innerHTML = `<div class="signal-empty">설정과 종가를 입력하면 신호가 표시됩니다</div>`;
    } else {
      list.innerHTML = items.map(it => `
        <div class="signal-item buy">
          <div>
            <div class="strategy">${it.strategy}</div>
            <div class="label">${it.label}${it.price ? ` @ $${fmt(it.price)}` : ''}</div>
          </div>
          <div class="action buy">${fmtInt(it.qty)}주</div>
        </div>
      `).join('');
    }
  }

  // ===== History =====
  async function renderHistory(strategy, containerId) {
    const trades = await DB.listTrades(currentTicker, strategy);
    const box = $(`#${containerId}`);
    if (trades.length === 0) {
      box.innerHTML = `<div class="history-empty">거래 이력이 없습니다</div>`;
      return;
    }
    box.innerHTML = trades.map(t => `
      <div class="history-item ${t.type === 'BUY' ? 'buy' : 'sell'}">
        <div class="date">${t.date || ''}</div>
        <div class="type">${t.type}</div>
        <div class="nums">$${fmt(t.price)} × ${fmtInt(t.qty)}</div>
        <button class="del" data-id="${t.id}">×</button>
      </div>
    `).join('');
    box.querySelectorAll('.del').forEach(btn => {
      btn.addEventListener('click', async () => {
        if (!confirm('이 거래를 삭제할까요?')) return;
        await DB.deleteTrade(+btn.dataset.id);
        toast('삭제됨');
        await refreshAll();
      });
    });
  }

  // ===== Trade modal & 카톡 파싱 =====
  function parseKakaoMessage(text) {
    if (!text || !text.trim()) return { ok: false, error: '메시지가 비어있습니다' };
    const grab = (keys) => {
      for (const key of keys) {
        const re = new RegExp(`${key}\\s*[:：]\\s*([^\\n\\r]+)`, 'i');
        const m = text.match(re);
        if (m) return m[1].trim();
      }
      return null;
    };
    const stockLine = grab(['종목명', '종목', '종목코드']);
    if (!stockLine) return { ok: false, error: '종목명을 찾을 수 없습니다' };
    const tickerMatch = stockLine.match(/\(([A-Z]{1,6})\)/);
    if (!tickerMatch) return { ok: false, error: '종목 코드를 찾을 수 없습니다 (괄호 안 TQQQ/SOXL 형태)' };
    const ticker = tickerMatch[1].toUpperCase();

    const sideRaw = grab(['매매구분', '구분', '매매']);
    if (!sideRaw) return { ok: false, error: '매매구분을 찾을 수 없습니다' };
    let type;
    if (sideRaw.includes('매수') || sideRaw.toUpperCase().includes('BUY')) type = 'BUY';
    else if (sideRaw.includes('매도') || sideRaw.toUpperCase().includes('SELL')) type = 'SELL';
    else return { ok: false, error: `매매구분 인식 실패: ${sideRaw}` };

    const priceRaw = grab(['체결단가', '단가', '체결가', '평균단가']);
    if (!priceRaw) return { ok: false, error: '체결단가를 찾을 수 없습니다' };
    const priceMatch = priceRaw.replace(/,/g, '').match(/([\d.]+)/);
    const price = parseFloat(priceMatch ? priceMatch[1] : 0);
    if (!price || price <= 0) return { ok: false, error: `잘못된 단가: ${priceRaw}` };

    const qtyRaw = grab(['체결수량', '수량', '주문수량']);
    if (!qtyRaw) return { ok: false, error: '수량을 찾을 수 없습니다' };
    const qtyMatch = qtyRaw.replace(/,/g, '').match(/(\d+)/);
    const qty = parseInt(qtyMatch ? qtyMatch[1] : 0, 10);
    if (qty <= 0) return { ok: false, error: `잘못된 수량: ${qtyRaw}` };

    const dateRaw = grab(['체결일자', '체결일', '거래일자', '일자']);
    let date;
    if (dateRaw) {
      let m = dateRaw.match(/(\d{4})[-./](\d{1,2})[-./](\d{1,2})/);
      if (m) {
        date = `${m[1]}-${m[2].padStart(2,'0')}-${m[3].padStart(2,'0')}`;
      } else {
        m = dateRaw.match(/(\d{1,2})[-./](\d{1,2})/);
        if (m) {
          const now = new Date(), year = now.getFullYear();
          const candidate = new Date(year, parseInt(m[1],10)-1, parseInt(m[2],10));
          const cutoff = new Date(now.getTime() + 7*86400000);
          const finalYear = candidate > cutoff ? year - 1 : year;
          date = `${finalYear}-${m[1].padStart(2,'0')}-${m[2].padStart(2,'0')}`;
        }
      }
    }
    if (!date) date = new Date().toISOString().slice(0,10);
    return { ok: true, ticker, type, price, qty, date };
  }

  function bindTradeModal() {
    const modal = $('#tradeModal');
    const openFor = (strategy, label) => {
      tradeContext = { strategy };
      $('#tradeModalTitle').textContent = `${label} 거래 추가`;
      $('#tradeDate').value = new Date().toISOString().slice(0,10);
      $('#tradeType').value = 'BUY';
      $('#tradePrice').value = '';
      $('#tradeQty').value = '';
      $('#tradeMemo').value = '';
      $('#kakaoPaste').value = '';
      $('#kakaoStatus').textContent = '';
      $('#kakaoStatus').classList.remove('ok', 'error', 'warn');
      modal.classList.add('show');
    };
    $('#m40AddTrade').addEventListener('click', () => openFor('m40', '40무매 V2.2'));
    $('#m20AddTrade').addEventListener('click', () => openFor('m20', '20무매 V3.0'));
    $('#vrAddTrade').addEventListener('click', () => openFor('vr', 'VR'));
    $('#tradeModalClose').addEventListener('click', () => modal.classList.remove('show'));
    modal.addEventListener('click', (e) => { if (e.target === modal) modal.classList.remove('show'); });

    $('#kakaoParseBtn').addEventListener('click', () => {
      const status = $('#kakaoStatus');
      status.classList.remove('ok','error','warn');
      const result = parseKakaoMessage($('#kakaoPaste').value);
      if (!result.ok) {
        status.textContent = `✗ ${result.error}`;
        status.classList.add('error');
        return;
      }
      let warnMsg = '';
      if (result.ticker !== currentTicker) {
        warnMsg = ` ⚠ 현재 ${currentTicker} 탭, 메시지는 ${result.ticker}. 저장 시 ${result.ticker}로 기록됨`;
      }
      $('#tradeDate').value = result.date;
      $('#tradeType').value = result.type;
      $('#tradePrice').value = result.price;
      $('#tradeQty').value = result.qty;
      $('#tradeMemo').value = `[카톡] ${result.ticker} ${result.type === 'BUY' ? '매수' : '매도'}`;
      const sideKor = result.type === 'BUY' ? '매수' : '매도';
      status.textContent = `✓ ${result.ticker} ${sideKor} ${result.qty}주 @ $${result.price.toFixed(2)} (${result.date})${warnMsg}`;
      status.classList.add(warnMsg ? 'warn' : 'ok');
      tradeContext.parsedTicker = result.ticker;
    });

    $('#tradeSave').addEventListener('click', async () => {
      if (!tradeContext) return;
      const ticker = tradeContext.parsedTicker || currentTicker;
      const trade = {
        ticker, strategy: tradeContext.strategy,
        date: $('#tradeDate').value,
        type: $('#tradeType').value,
        price: +$('#tradePrice').value || 0,
        qty: +$('#tradeQty').value || 0,
        memo: $('#tradeMemo').value || '',
      };
      if (!trade.date || !trade.price || !trade.qty) {
        toast('날짜·가격·수량을 입력하세요');
        return;
      }
      await DB.addTrade(trade);
      modal.classList.remove('show');
      tradeContext = null;
      if (ticker !== currentTicker) {
        currentTicker = ticker;
        await DB.setApp('currentTicker', currentTicker);
        await renderTickerSwitch();
        await loadConfigsToUI();
        toast(`${ticker} 거래 추가, 종목 자동 전환됨`);
      } else {
        toast('거래 추가됨');
      }
      await refreshAll();
    });
  }

  // ===== Settings =====
  async function renderTickerList() {
    const tickers = await DB.getTickers();
    const list = $('#tickerList');
    list.innerHTML = tickers.map((t, i) => {
      const sf = t.starFormula || { const: 15, coef: -1.5 };
      return `
      <div class="ticker-item-extended" style="border-left-color:${t.color}">
        <div class="ticker-item-row">
          <div class="swatch" style="background:${t.color}"></div>
          <div class="sym">${t.symbol}</div>
          <button class="remove" data-idx="${i}">삭제</button>
        </div>
        <div class="ticker-formula-row">
          <span class="formula-label">20무매 ★% = </span>
          <input type="number" step="0.1" class="formula-const" data-idx="${i}" value="${sf.const}" placeholder="15">
          <span class="formula-op">+</span>
          <input type="number" step="0.1" class="formula-coef" data-idx="${i}" value="${sf.coef}" placeholder="-1.5">
          <span class="formula-op">× T</span>
        </div>
      </div>`;
    }).join('');
    list.querySelectorAll('.remove').forEach(btn => {
      btn.addEventListener('click', async () => {
        const idx = +btn.dataset.idx;
        const cur = await DB.getTickers();
        if (cur.length <= 1) { toast('최소 1개 종목 유지'); return; }
        const removed = cur[idx];
        if (!confirm(`${removed.symbol} 종목을 삭제할까요?`)) return;
        cur.splice(idx, 1);
        await DB.setTickers(cur);
        await renderTickerList();
        await renderTickerSwitch();
        await loadConfigsToUI();
        await refreshAll();
        toast('삭제됨');
      });
    });
    list.querySelectorAll('.formula-const, .formula-coef').forEach(inp => {
      inp.addEventListener('change', async () => {
        const idx = +inp.dataset.idx;
        const cur = await DB.getTickers();
        const c = parseFloat(list.querySelector(`.formula-const[data-idx="${idx}"]`).value);
        const k = parseFloat(list.querySelector(`.formula-coef[data-idx="${idx}"]`).value);
        cur[idx].starFormula = {
          const: isNaN(c) ? 15 : c,
          coef: isNaN(k) ? -1.5 : k,
        };
        await DB.setTickers(cur);
        await refreshAll();
        toast(`${cur[idx].symbol} ★% 산식 저장`);
      });
    });
  }

  function bindSettings() {
    $('#addTickerBtn').addEventListener('click', async () => {
      const sym = $('#newTickerSymbol').value.trim().toUpperCase();
      const color = $('#newTickerColor').value || '#2563eb';
      if (!sym) { toast('심볼을 입력하세요'); return; }
      if (!/^[A-Z]{1,6}$/.test(sym)) { toast('심볼은 영문 1~6자'); return; }
      const cur = await DB.getTickers();
      if (cur.find(t => t.symbol === sym)) { toast('이미 등록된 종목입니다'); return; }
      cur.push({ symbol: sym, color, starFormula: { const: 15, coef: -1.5 } });
      await DB.setTickers(cur);
      $('#newTickerSymbol').value = '';
      await renderTickerList();
      await renderTickerSwitch();
      toast(`${sym} 추가됨`);
    });

    $('#finnhubKeySave').addEventListener('click', async () => {
      const key = $('#finnhubKey').value.trim();
      if (!key) { toast('키를 입력하세요'); return; }
      await DB.setApp('finnhubKey', key);
      toast('API 키 저장됨');
    });
    $('#finnhubKeyTest').addEventListener('click', async () => {
      const key = $('#finnhubKey').value.trim() || await DB.getApp('finnhubKey');
      if (!key) { toast('키를 먼저 입력/저장하세요'); return; }
      const btn = $('#finnhubKeyTest');
      btn.textContent = '테스트 중...'; btn.disabled = true;
      try {
        const q = await fetchFinnhubQuote('AAPL', key);
        toast(`연결 성공 (AAPL $${q.current.toFixed(2)})`);
      } catch (err) {
        toast(`실패: ${err.message}`);
      } finally {
        btn.textContent = '연결 테스트'; btn.disabled = false;
      }
    });

    $('#exportData').addEventListener('click', async () => {
      const data = await DB.exportAll();
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `infinity-backup-${new Date().toISOString().slice(0,10)}.json`;
      a.click();
      URL.revokeObjectURL(url);
      toast('내보내기 완료');
    });
    $('#importData').addEventListener('click', () => $('#importFile').click());
    $('#importFile').addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (!confirm('현재 데이터를 모두 덮어씁니다. 진행할까요?')) return;
        await DB.importAll(data);
        toast('가져오기 완료');
        await renderTickerSwitch();
        await renderTickerList();
        await loadConfigsToUI();
        await refreshAll();
      } catch (err) {
        toast('파일 형식 오류'); console.error(err);
      }
      e.target.value = '';
    });
    $('#resetData').addEventListener('click', async () => {
      if (!confirm('정말로 모든 데이터를 초기화할까요?')) return;
      await DB.resetAll();
      toast('초기화 완료');
      await renderTickerSwitch();
      await renderTickerList();
      await loadConfigsToUI();
      await refreshAll();
    });
  }

  // ===== Main refresh =====
  async function refreshAll() {
    const price = await getTodayPrice();
    const m40 = await DB.getConfig(currentTicker, 'm40');
    const m20 = await DB.getConfig(currentTicker, 'm20');
    const vr = await DB.getConfig(currentTicker, 'vr');

    const tickers = await DB.getTickers();
    const tickerObj = tickers.find(t => t.symbol === currentTicker);
    const starFormula = tickerObj ? tickerObj.starFormula : null;

    const trades40 = await DB.listTrades(currentTicker, 'm40');
    const trades20 = await DB.listTrades(currentTicker, 'm20');

    let r40 = null, r20 = null, rVR = null;
    if (m40 && m40.seed && price) {
      r40 = Strategies.calcInfinity({
        strategy: 'm40',
        seed: m40.seed,
        perRoundBaseAmt: m40.perRoundBaseAmt,
        trades: trades40,
        todayPrice: price,
        mode: m40.mode || 'NORMAL',
      });
    }
    if (m20 && m20.seed && price) {
      r20 = Strategies.calcInfinity({
        strategy: 'm20',
        seed: m20.seed,
        perRoundBaseAmt: m20.perRoundBaseAmt,
        starFormula,
        trades: trades20,
        todayPrice: price,
        mode: m20.mode || 'NORMAL',
      });
    }
    if (vr && price) rVR = Strategies.calcVR({ ...vr, todayPrice: price });

    renderInfinityResult('m40Result', r40, '40무매 V2.2');
    renderInfinityResult('m20Result', r20, '20무매 V3.0');
    renderResultVR(rVR);
    renderDashboard(r40, r20, rVR);

    await renderHistory('m40', 'm40History');
    await renderHistory('m20', 'm20History');
    await renderHistory('vr', 'vrHistory');
  }

  // ===== Init =====
  async function init() {
    const savedTicker = await DB.getApp('currentTicker');
    const tickers = await DB.getTickers();
    if (savedTicker && tickers.find(t => t.symbol === savedTicker)) currentTicker = savedTicker;
    else currentTicker = tickers[0].symbol;
    await renderTickerSwitch();
    bindHeader();
    bindHero();
    bindConfigSave();
    bindTradeModal();
    bindSettings();
    await renderTickerList();
    await loadConfigsToUI();
    await refreshAll();
  }

  return { init };
})();

document.addEventListener('DOMContentLoaded', () => App.init());
