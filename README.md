# 오션의 무한매수 VR 트래커 (PWA)

TQQQ / SOXL 대상 **40무매 · 20무매 · VR(Value Rebalancing)** 트래커.
맥북에서 개발 → GitHub Pages 무료 배포 → 아이폰/아이패드 Safari에서 홈화면 추가.

## 기능

- 종목 전환 (TQQQ / SOXL)
- 종가 입력 시 세 전략의 매수가·매수량·매도신호 자동 계산
- 거래 이력 기록 (날짜·매수/매도·가격·수량·메모)
- 데이터 백업/복원 (JSON 내보내기·가져오기)
- 완전 오프라인 동작 (Service Worker)
- IndexedDB 로컬 저장 (외부 서버 없음)
- 아이폰 홈화면 추가 시 네이티브 앱처럼 동작

## 파일 구조

```
infinity-pwa/
├── index.html
├── manifest.json
├── sw.js                  # 서비스 워커
├── css/
│   └── style.css
├── js/
│   ├── db.js              # IndexedDB
│   ├── strategies.js      # 40무매/20무매/VR 계산 로직
│   └── app.js             # UI
└── icons/
    ├── icon-192.png
    └── icon-512.png
```

## 맥북에서 로컬 실행

PWA는 file:// 로는 Service Worker가 동작하지 않으므로 로컬 서버가 필요합니다.

```bash
cd infinity-pwa
python3 -m http.server 8000
```

브라우저에서 `http://localhost:8000` 접속.

VS Code의 **Live Server** 확장도 동일하게 됩니다.

## GitHub Pages 배포

1. GitHub에서 새 저장소 생성 (예: `infinity-pwa`, public)
2. 맥북 터미널에서:
   ```bash
   cd infinity-pwa
   git init
   git add .
   git commit -m "initial"
   git branch -M main
   git remote add origin https://github.com/<USERNAME>/infinity-pwa.git
   git push -u origin main
   ```
3. GitHub 저장소 → Settings → Pages
   - Source: `Deploy from a branch`
   - Branch: `main` / `/ (root)`
   - Save
4. 2~3분 뒤 `https://<USERNAME>.github.io/infinity-pwa/` 접속 가능

## 아이폰 홈화면 추가

1. 위 URL을 **Safari**로 열기 (Chrome 불가)
2. 하단 공유 버튼 → "홈 화면에 추가"
3. 이후 홈에서 아이콘으로 실행하면 전체화면 앱처럼 동작
4. 오프라인 동작, 데이터는 기기 로컬에 저장됨

## 사용 흐름

1. 상단에서 종목 선택 (TQQQ / SOXL)
2. **대시보드** 상단에 오늘 종가 입력
3. **40무매 / 20무매 / VR** 탭에서 시드·평단·수량·회차 등 입력 후 저장
4. 대시보드에서 세 전략 신호 한 눈에 확인
5. 실제 거래 후 각 탭 "거래 이력 +" 버튼으로 기록

## 데이터 백업

설정 탭 → **데이터 내보내기**: JSON 파일로 다운로드 → 아이클라우드 드라이브 등에 보관.
복원은 **데이터 가져오기**.

## 전략 로직 요약 (단순화 버전)

### 40무매 V2.2
- `1회 매수자금 = 시드 / 40`
- 평단보다 종가가 **낮으면**: 1회분 × 2 (큰매수)
- 평단~익절목표가 사이: 1회분 (정상매수)
- 익절목표가 도달: **전량매도**
- 40회 도달: **쿼터 손절 (보유 1/4 매도)**

### 20무매
- 40무매와 동일 구조, 분할이 20. 익절 목표 5%로 단축.

### VR
- `V = (V₀ + 월적립누계) × (1 + (0.01/G) × 경과일/30)`
- 평가금 `E > V × 상단%` → 매도
- 평가금 `E < V × 하단%` → 매수 (예수금 한도 내)

> 책의 정확한 V2.2 매수표·실력공식과는 차이가 있을 수 있습니다.
> `js/strategies.js`에서 익절률·큰매수배율 등 조정 가능.

## 라이센스

개인 사용 목적. 투자 자문이 아니며, 모든 책임은 사용자에게 있습니다.
