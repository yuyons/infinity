// db.js - IndexedDB wrapper
const DB_NAME = 'infinity-tracker';
const DB_VERSION = 1;

const DB = (() => {
  let _db = null;

  function open() {
    return new Promise((resolve, reject) => {
      if (_db) return resolve(_db);
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onsuccess = () => { _db = req.result; resolve(_db); };
      req.onupgradeneeded = (e) => {
        const db = e.target.result;
        // config: per-ticker per-strategy settings + state
        // key = `${ticker}:${strategy}`  e.g. "TQQQ:m40", "TQQQ:vr"
        if (!db.objectStoreNames.contains('config')) {
          db.createObjectStore('config', { keyPath: 'id' });
        }
        // trades: 거래 이력
        if (!db.objectStoreNames.contains('trades')) {
          const s = db.createObjectStore('trades', { keyPath: 'id', autoIncrement: true });
          s.createIndex('by_ticker_strategy', ['ticker', 'strategy']);
          s.createIndex('by_date', 'date');
        }
        // app: global app state (e.g. todayPrice cache)
        if (!db.objectStoreNames.contains('app')) {
          db.createObjectStore('app', { keyPath: 'key' });
        }
      };
    });
  }

  async function tx(storeName, mode = 'readonly') {
    const db = await open();
    return db.transaction(storeName, mode).objectStore(storeName);
  }

  // ----- config -----
  async function getConfig(ticker, strategy) {
    const store = await tx('config');
    return new Promise((res, rej) => {
      const r = store.get(`${ticker}:${strategy}`);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
  }

  async function setConfig(ticker, strategy, data) {
    const store = await tx('config', 'readwrite');
    return new Promise((res, rej) => {
      const r = store.put({ id: `${ticker}:${strategy}`, ticker, strategy, ...data });
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }

  // ----- trades -----
  async function addTrade(trade) {
    const store = await tx('trades', 'readwrite');
    return new Promise((res, rej) => {
      const r = store.add(trade);
      r.onsuccess = () => res(r.result);
      r.onerror = () => rej(r.error);
    });
  }

  async function deleteTrade(id) {
    const store = await tx('trades', 'readwrite');
    return new Promise((res, rej) => {
      const r = store.delete(id);
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }

  async function listTrades(ticker, strategy) {
    const store = await tx('trades');
    const idx = store.index('by_ticker_strategy');
    return new Promise((res, rej) => {
      const out = [];
      const cursorReq = idx.openCursor(IDBKeyRange.only([ticker, strategy]));
      cursorReq.onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) { out.push(cur.value); cur.continue(); }
        else {
          out.sort((a, b) => (b.date || '').localeCompare(a.date || ''));
          res(out);
        }
      };
      cursorReq.onerror = () => rej(cursorReq.error);
    });
  }

  // ----- app state -----
  async function setApp(key, value) {
    const store = await tx('app', 'readwrite');
    return new Promise((res, rej) => {
      const r = store.put({ key, value });
      r.onsuccess = () => res();
      r.onerror = () => rej(r.error);
    });
  }
  async function getApp(key) {
    const store = await tx('app');
    return new Promise((res, rej) => {
      const r = store.get(key);
      r.onsuccess = () => res(r.result ? r.result.value : null);
      r.onerror = () => rej(r.error);
    });
  }

  // ----- export / import -----
  async function exportAll() {
    const db = await open();
    const stores = ['config', 'trades', 'app'];
    const out = {};
    for (const name of stores) {
      out[name] = await new Promise((res, rej) => {
        const r = db.transaction(name).objectStore(name).getAll();
        r.onsuccess = () => res(r.result);
        r.onerror = () => rej(r.error);
      });
    }
    out._meta = { exportedAt: new Date().toISOString(), version: DB_VERSION };
    return out;
  }

  async function importAll(data) {
    const db = await open();
    const stores = ['config', 'trades', 'app'];
    return new Promise((resolve, reject) => {
      const t = db.transaction(stores, 'readwrite');
      for (const name of stores) {
        const s = t.objectStore(name);
        s.clear();
        const arr = data[name] || [];
        for (const item of arr) s.put(item);
      }
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  async function resetAll() {
    const db = await open();
    return new Promise((resolve, reject) => {
      const t = db.transaction(['config', 'trades', 'app'], 'readwrite');
      t.objectStore('config').clear();
      t.objectStore('trades').clear();
      t.objectStore('app').clear();
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
    });
  }

  // ----- tickers (사용자 등록 종목) -----
  // app store에 'tickers' 키로 배열 저장: [{symbol, color}, ...]
  // color는 hex string (예: '#2563eb')
  async function getTickers() {
    const v = await getApp('tickers');
    if (v && Array.isArray(v) && v.length > 0) return v;
    // 기본값: TQQQ (15-1.5T), SOXL (20-2T)
    return [
      { symbol: 'TQQQ', color: '#2563eb', starFormula: { const: 15, coef: -1.5 } },
      { symbol: 'SOXL', color: '#ea580c', starFormula: { const: 20, coef: -2 } },
    ];
  }
  async function setTickers(arr) {
    return setApp('tickers', arr);
  }

  return {
    getConfig, setConfig,
    addTrade, deleteTrade, listTrades,
    setApp, getApp,
    getTickers, setTickers,
    exportAll, importAll, resetAll,
  };
})();
