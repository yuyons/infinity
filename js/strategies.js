// strategies.js - 무한매수법 계산 엔진
// - 40무매 V2.2 (★% = 12 - T×0.6, a=40)
// - 20무매 V3.0 (★% = const + coef×T, 종목별 산식, a=20)
// - VR (Value Rebalancing)

const Strategies = (() => {

  // ===== 공통 유틸 =====
  const round = (n, d = 2) => Math.round(n * 10**d) / 10**d;
  const floor = (n) => Math.floor(n);
  // 소수점 d째 자리에서 올림 (T값 계산용)
  const ceilTo = (n, d) => Math.ceil(n * 10**d) / 10**d;
  // 음수도 처리 가능한 round (양수만 round해서 음수에서도 동일하게 동작)
  const round2 = (n) => Math.round(n * 100) / 100;

  // ===== 사이클 / 거래이력 분석 =====
  // 거래 이력에서 마지막 "사이클 종료" 시점 이후의 거래만 추려서
  // 평단·보유수량·매수누적액·실현수익을 계산
  //
  // 사이클 종료 = 누적 보유수량이 0이 되는 시점
  // (전량매도가 발생해서 보유가 비면 사이클 끝)
  //
  // trades: [{ date, type: 'BUY'|'SELL', price, qty }, ...]
  function analyzeCycle(trades) {
    if (!trades || trades.length === 0) {
      return {
        cycleTrades: [],
        qty: 0,
        avgPrice: 0,
        buyAccum: 0,
        sellAccum: 0,
        realized: 0,
        prevCyclesRealized: 0,
      };
    }
    // 시간 오름차순
    const sorted = [...trades].sort((a, b) =>
      (a.date || '').localeCompare(b.date || '') ||
      ((a.id || 0) - (b.id || 0))
    );

    // 누적 보유수량 추적하며 사이클 경계 찾기
    // 각 거래마다 보유가 0이 되는 지점 = 사이클 종료
    let qty = 0;
    let totalCost = 0;
    let prevCyclesRealized = 0;
    let cycleStartIdx = 0;

    for (let i = 0; i < sorted.length; i++) {
      const t = sorted[i];
      const p = Number(t.price) || 0;
      const q = Number(t.qty) || 0;
      if (t.type === 'BUY') {
        totalCost += p * q;
        qty += q;
      } else if (t.type === 'SELL') {
        const avgBefore = qty > 0 ? totalCost / qty : 0;
        prevCyclesRealized += (p - avgBefore) * q;  // 누적 실현수익
        totalCost -= avgBefore * q;
        qty -= q;
        if (qty <= 0.0001) {
          // 사이클 종료
          qty = 0;
          totalCost = 0;
          cycleStartIdx = i + 1;
        }
      }
    }

    // 현재 사이클 거래만 추출
    const cycleTrades = sorted.slice(cycleStartIdx);

    // 현재 사이클의 평단/수량/누적
    let cQty = 0;
    let cTotalCost = 0;
    let cBuyAccum = 0;
    let cSellAccum = 0;
    let cRealized = 0;
    for (const t of cycleTrades) {
      const p = Number(t.price) || 0;
      const q = Number(t.qty) || 0;
      if (t.type === 'BUY') {
        cTotalCost += p * q;
        cBuyAccum += p * q;
        cQty += q;
      } else if (t.type === 'SELL') {
        const avgBefore = cQty > 0 ? cTotalCost / cQty : 0;
        cRealized += (p - avgBefore) * q;
        cSellAccum += p * q;
        cTotalCost -= avgBefore * q;
        cQty -= q;
        if (cQty < 0) cQty = 0;
        if (cTotalCost < 0) cTotalCost = 0;
      }
    }

    // prevCyclesRealized에서 현재 사이클 분 제외
    const trulyPrevRealized = prevCyclesRealized - cRealized;

    return {
      cycleTrades,
      qty: cQty,
      avgPrice: cQty > 0 ? round(cTotalCost / cQty, 4) : 0,
      buyAccum: round(cBuyAccum),
      sellAccum: round(cSellAccum),
      realized: round(cRealized),
      prevCyclesRealized: round(trulyPrevRealized),
    };
  }

  // ===== T값 계산 =====
  // T = 매수누적액 / 1회매수액, 소수 둘째자리에서 올림 (셋째자리 반올림 → 사용자 선호 따라 변경 가능)
  // 2024.09.05 update: 셋째자리에서 반올림으로 변경
  function calcT(buyAccum, perRoundAmt) {
    if (!perRoundAmt || perRoundAmt <= 0) return 0;
    const raw = buyAccum / perRoundAmt;
    // 셋째자리에서 반올림 → 둘째자리까지 표시
    return Math.round(raw * 100) / 100;
  }

  // ===== ★% 계산 =====
  // 40무매 V2.2: ★% = 12 - T × 0.6
  // 20무매 V3.0: ★% = const + coef × T (종목별)
  function calcStarPct(T, strategy, starFormula) {
    if (strategy === 'm40') {
      return 12 - T * 0.6;
    } else if (strategy === 'm20') {
      // starFormula = { const: 15, coef: -1.5 } 같은 형태
      if (!starFormula) return 0;
      return starFormula.const + starFormula.coef * T;
    }
    return 0;
  }

  // ===== 전반전 / 후반전 판정 =====
  // 40무매: T < 20 전반, T ≥ 20 후반
  // 20무매: T < 10 전반, T ≥ 10 후반
  function isFirstHalf(T, strategy) {
    if (strategy === 'm40') return T < 20;
    if (strategy === 'm20') return T < 10;
    return T < 10;
  }

  // ===== 쿼터손절 진입 판정 =====
  // 40무매: 39 < T ≤ 40
  // 20무매: 19 < T ≤ 20
  function isQuarterLossZone(T, strategy) {
    if (strategy === 'm40') return T > 39 && T <= 40;
    if (strategy === 'm20') return T > 19 && T <= 20;
    return false;
  }

  // ===== 메인 계산: 40무매 V2.2 / 20무매 V3.0 공통 =====
  //
  // 입력:
  //   strategy: 'm40' | 'm20'
  //   seed: 원금
  //   perRoundBaseAmt: 1회매수액 (반복리로 갱신된 값, 없으면 seed/a)
  //   starFormula: 20무매 V3.0의 종목별 산식 (m40에서는 무시)
  //   trades: 거래 이력 전체
  //   todayPrice: 오늘 종가 (또는 장중 가격)
  //   mode: 'NORMAL' | 'QUARTER_LOSS' (현재 모드, 사용자가 설정 또는 자동 감지)
  //
  // 출력: { T, starPct, half, mode, buyOrders, sellOrders, ... }
  function calcInfinity(opts) {
    const {
      strategy,
      seed,
      perRoundBaseAmt,
      starFormula,
      trades = [],
      todayPrice,
      mode = 'NORMAL',
    } = opts;

    if (!seed || !todayPrice) return null;

    const a = strategy === 'm40' ? 40 : 20;
    const perRound = perRoundBaseAmt || (seed / a);

    // 거래 이력 분석
    const analysis = analyzeCycle(trades);
    const { qty, avgPrice, buyAccum, realized, prevCyclesRealized } = analysis;

    // T값 계산
    const T = calcT(buyAccum, perRound);

    // ★% 계산
    const starPct = calcStarPct(T, strategy, starFormula);

    // 전후반 판정
    const half = isFirstHalf(T, strategy) ? 'first' : 'second';

    // 쿼터손절 자동 감지 (mode가 NORMAL이어도 T가 영역에 들어오면 경고)
    const quarterZone = isQuarterLossZone(T, strategy);

    // 평가금 / 수익률
    const evalAmt = qty * todayPrice;
    const profitRate = avgPrice > 0 ? (todayPrice / avgPrice - 1) * 100 : 0;

    // 평단 0 (사이클 시작 직후) 처리: 평단 자리에 종가 사용
    const refPrice = avgPrice > 0 ? avgPrice : todayPrice;

    // ===== 매수 호가 =====
    const buyOrders = [];

    if (mode === 'QUARTER_LOSS') {
      // 쿼터손절 모드: -12% LOC 매수만 (a=40 기준; 20무매도 동일하게 처리)
      const price = round2(refPrice * (1 - 12/100) - 0.01);
      const qtyOrder = floor(perRound / price);
      buyOrders.push({
        kind: 'QL_LOC',
        label: '-12% LOC',
        price,
        qty: qtyOrder,
        amt: round2(qtyOrder * price),
        starPctUsed: -12,
      });
    } else if (half === 'first') {
      // 전반전: 1회분 절반은 0% LOC, 절반은 ★% LOC
      const halfAmt = perRound / 2;
      // 0% LOC 매수 = 평단 - 0.01
      const zeroPrice = round2(refPrice * (1 + 0/100) - 0.01);
      const zeroQty = floor(halfAmt / zeroPrice);
      buyOrders.push({
        kind: 'ZERO_LOC',
        label: '0% LOC',
        price: zeroPrice,
        qty: zeroQty,
        amt: round2(zeroQty * zeroPrice),
        starPctUsed: 0,
      });
      // ★% LOC 매수 = 평단 × (1+★%) - 0.01
      const starPrice = round2(refPrice * (1 + starPct/100) - 0.01);
      const starQty = floor(halfAmt / starPrice);
      buyOrders.push({
        kind: 'STAR_LOC',
        label: `★% LOC (${starPct >= 0 ? '+' : ''}${starPct.toFixed(2)}%)`,
        price: starPrice,
        qty: starQty,
        amt: round2(starQty * starPrice),
        starPctUsed: starPct,
      });
    } else {
      // 후반전: 1회분 전체를 ★% LOC
      const starPrice = round2(refPrice * (1 + starPct/100) - 0.01);
      const starQty = floor(perRound / starPrice);
      buyOrders.push({
        kind: 'STAR_LOC',
        label: `★% LOC (${starPct >= 0 ? '+' : ''}${starPct.toFixed(2)}%)`,
        price: starPrice,
        qty: starQty,
        amt: round2(starQty * starPrice),
        starPctUsed: starPct,
      });
    }

    // ===== 매도 호가 =====
    const sellOrders = [];
    if (qty > 0 && avgPrice > 0) {
      const quarterQty = floor(qty / 4);
      const restQty = qty - quarterQty;

      if (mode === 'QUARTER_LOSS') {
        // 쿼터손절 모드 매도:
        //   1~10회 매수 기간: 누적 1/4 = -12% LOC 매도, 나머지 = 12% 지정가 매도
        //   (10회 매수 후 다시 MOC 매도는 별도 액션으로 처리 — 여기선 기본 호가만)
        const locSellPrice = round2(refPrice * (1 - 12/100));
        const limitSellPrice = round2(refPrice * (1 + 12/100));
        if (quarterQty > 0) {
          sellOrders.push({
            kind: 'QL_LOC_SELL',
            label: '-12% LOC 매도 (1/4)',
            price: locSellPrice,
            qty: quarterQty,
            amt: round2(quarterQty * locSellPrice),
            pnl: round2((locSellPrice - avgPrice) * quarterQty),
          });
        }
        if (restQty > 0) {
          sellOrders.push({
            kind: 'LIMIT_SELL',
            label: '+12% 지정가 매도 (3/4)',
            price: limitSellPrice,
            qty: restQty,
            amt: round2(restQty * limitSellPrice),
            pnl: round2((limitSellPrice - avgPrice) * restQty),
          });
        }
      } else {
        // 정상 모드 매도:
        //   누적 1/4 = ★% LOC 매도 (★%에 -0.01 안 함, 매수가가 -0.01이므로 자동 분리)
        //   누적 3/4 = +12% 지정가 매도
        const locSellPrice = round2(refPrice * (1 + starPct/100));
        const limitSellPrice = round2(refPrice * (1 + 12/100));
        if (quarterQty > 0) {
          sellOrders.push({
            kind: 'STAR_LOC_SELL',
            label: `★% LOC 매도 (1/4, ${starPct >= 0 ? '+' : ''}${starPct.toFixed(2)}%)`,
            price: locSellPrice,
            qty: quarterQty,
            amt: round2(quarterQty * locSellPrice),
            pnl: round2((locSellPrice - avgPrice) * quarterQty),
          });
        }
        if (restQty > 0) {
          sellOrders.push({
            kind: 'LIMIT_SELL',
            label: '+12% 지정가 매도 (3/4)',
            price: limitSellPrice,
            qty: restQty,
            amt: round2(restQty * limitSellPrice),
            pnl: round2((limitSellPrice - avgPrice) * restQty),
          });
        }
      }
    }

    return {
      strategy,
      mode,
      T: round(T, 2),
      starPct: round(starPct, 2),
      half,
      quarterZone,  // 39<T≤40 또는 19<T≤20 진입 경고
      perRound: round2(perRound),
      a,
      qty,
      avgPrice,
      buyAccum,
      evalAmt: round2(evalAmt),
      profitRate: round(profitRate, 2),
      remainSeed: round2(seed - buyAccum),
      buyOrders,
      sellOrders,
      prevCyclesRealized,  // 반복리 추적용
    };
  }

  // ===== VR (Value Rebalancing) - 정식 공식 =====
  //
  // 공식:
  //   V₂ = V₁ + Pool/G ± (적립금 or 인출금)
  //   (V₂는 2주마다 갱신)
  //
  // 밴드:
  //   최대 = V × (1 + bandPct/100)
  //   최소 = V × (1 - bandPct/100)
  //
  // 모드:
  //   ACCUMULATE: 사이클마다 +contribAmt
  //   HOLD: ±0
  //   WITHDRAW: 사이클마다 -contribAmt
  //
  // 입력:
  //   V: 현재 사이클의 V값
  //   pool: 현재 현금
  //   G: 기울기 분모
  //   bandPct: 밴드 폭 %
  //   mode: 'ACCUMULATE' | 'HOLD' | 'WITHDRAW'
  //   contribAmt: 사이클당 적립/인출 금액
  //   qty: 현재 보유 수량
  //   todayPrice: 오늘 종가
  //   startDate: 현재 사이클 시작일
  //   cycleDays: 2주 = 14 (사이클 주기)
  //   asOfDate: 평가 기준일 (기본 오늘)
  function calcVR(opts) {
    const {
      V,
      pool = 0,
      G = 10,
      bandPct = 15,
      mode = 'ACCUMULATE',
      contribAmt = 0,
      qty = 0,
      todayPrice,
      startDate,  // 현재 사이클 시작일
      cycleDays = 14,
      asOfDate,
    } = opts;

    if (!V || !todayPrice) return null;

    // 다음 사이클의 V값 계산 (= 2주 뒤에 적용될 V)
    let contribSign = 0;
    if (mode === 'ACCUMULATE') contribSign = 1;
    else if (mode === 'WITHDRAW') contribSign = -1;
    const nextV = V + pool / G + contribSign * contribAmt;

    // 사이클 진행 일수
    let daysInCycle = 0;
    let cycleProgress = 0;
    if (startDate) {
      const start = new Date(startDate);
      const today = asOfDate ? new Date(asOfDate) : new Date();
      daysInCycle = Math.max(0, Math.floor((today - start) / 86400000));
      cycleProgress = Math.min(100, (daysInCycle / cycleDays) * 100);
    }
    const daysUntilNext = Math.max(0, cycleDays - daysInCycle);
    const needsRefresh = daysInCycle >= cycleDays;

    // 평가금 / 밴드
    const E = qty * todayPrice;
    const upperLine = V * (1 + bandPct/100);
    const lowerLine = V * (1 - bandPct/100);

    // 신호 판정
    let signal = 'HOLD';
    let action = '관망';
    let note = `밴드 내 (${V * (1 - bandPct/100) | 0} ~ ${V * (1 + bandPct/100) | 0})`;
    let targetShares = 0;
    let targetAmount = 0;
    let buyPrice = 0;
    let sellPrice = 0;

    if (E < lowerLine) {
      // 매수: 평가금을 V까지 끌어올림
      signal = 'BUY';
      targetAmount = V - E;
      const want = floor(targetAmount / todayPrice);
      const maxBuyable = floor(pool / todayPrice);
      targetShares = Math.min(want, maxBuyable);
      buyPrice = todayPrice;
      if (targetShares < want) {
        action = `매수 (Pool 한도)`;
        note = `하단 돌파 → ${targetShares}주 매수 (희망 ${want}주, Pool 부족)`;
      } else {
        action = '매수';
        note = `하단 돌파 → V값까지 ${targetShares}주 매수`;
      }
    } else if (E > upperLine) {
      // 매도: 평가금을 V까지 끌어내림
      signal = 'SELL';
      targetAmount = E - V;
      targetShares = floor(targetAmount / todayPrice);
      sellPrice = todayPrice;
      action = '매도';
      note = `상단 돌파 → V값까지 ${targetShares}주 매도`;
    }

    // 매수표 생성 (현재가에서 가격이 더 내려가면 단계별 매수)
    // 평가금이 lowerLine 아래로 더 떨어질 때마다 1주씩 추가 매수해서 V에 맞추는 사다리
    const buyLadder = [];
    if (qty > 0) {
      // 보유 1주씩 증가시키면서 그에 맞는 가격·풀 계산
      // 단순화: 현재 qty에서 +10주까지 단계별 가격 표시
      let simPool = pool;
      let simQty = qty;
      for (let i = 1; i <= 10; i++) {
        // simQty주 보유 시, 평가금이 lowerLine이 되는 가격
        const triggerPrice = lowerLine / (simQty + i);
        if (triggerPrice <= 0) break;
        const cost = triggerPrice * 1;  // 1주씩
        if (simPool < cost) break;
        simPool -= cost;
        buyLadder.push({
          step: i,
          qtyAfter: simQty + i,
          buyPrice: round(triggerPrice, 2),
          poolAfter: round2(simPool),
        });
      }
    }

    // 매도표 생성 (상승 시 매도 사다리)
    const sellLadder = [];
    if (qty > 0) {
      let simPool = pool;
      let simQty = qty;
      for (let i = 1; i <= 10; i++) {
        if (simQty - i + 1 <= 0) break;
        // simQty주 보유 시, 평가금이 upperLine이 되는 가격
        const triggerPrice = upperLine / (simQty - i + 1);
        if (triggerPrice <= 0) break;
        simPool += triggerPrice;
        simQty -= 0;  // 표시상 누적
        sellLadder.push({
          step: i,
          qtyAfter: qty - i,
          sellPrice: round(triggerPrice, 2),
          poolAfter: round2(simPool),
        });
      }
    }

    return {
      signal,
      action,
      note,
      V: round(V),
      nextV: round(nextV),
      E: round(E),
      upperLine: round(upperLine),
      lowerLine: round(lowerLine),
      bandPct,
      G,
      mode,
      pool: round2(pool),
      qty,
      targetShares: Math.abs(targetShares),
      targetAmount: round(Math.abs(targetAmount)),
      buyPrice: round(buyPrice, 2),
      sellPrice: round(sellPrice, 2),
      daysInCycle,
      daysUntilNext,
      cycleProgress: round(cycleProgress, 1),
      cycleDays,
      needsRefresh,
      contribAmt,
      totalEquity: round(E + pool),
      buyLadder,
      sellLadder,
    };
  }

  // ===== VR 사이클 V값 갱신 =====
  // 현재 V·Pool·모드 입력 → 다음 사이클 V값과 시작일 반환
  function refreshVRCycle(opts) {
    const { V, pool = 0, G = 10, mode = 'ACCUMULATE', contribAmt = 0, today } = opts;
    let contribSign = 0;
    if (mode === 'ACCUMULATE') contribSign = 1;
    else if (mode === 'WITHDRAW') contribSign = -1;
    const nextV = V + pool / G + contribSign * contribAmt;
    const newStartDate = (today || new Date()).toISOString().slice(0, 10);
    return {
      V: round(nextV, 2),
      startDate: newStartDate,
    };
  }

  return {
    calcInfinity,
    analyzeCycle,
    calcT,
    calcStarPct,
    isFirstHalf,
    isQuarterLossZone,
    calcVR,
    refreshVRCycle,
  };
})();
