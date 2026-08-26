// NScouter 스캐터 차트 검증용 부하 시나리오
//
// 목적은 처리량이 아니라 "다양한 XLog"를 만드는 것이다.
//  - 넓은 elapsed 분포  → Y축 검증
//  - error != 0        → 빨간 점
//  - 앱 간 호출        → gxid / caller / apicall 프로파일
//  - SQL 다건          → sqlCount / sqlTime
import http from 'k6/http';
import { sleep } from 'k6';

const SHOP = __ENV.SHOP_URL || 'http://shop-app:8081';
const ORDER = __ENV.ORDER_URL || 'http://order-app:8082';
const PRODUCT_MAX = 200;

// K6_VUS / K6_DURATION 환경변수가 아래 값을 덮어쓴다 (k6 기본 동작).
export const options = {
    vus: 5,
    duration: '30m',
    // 부하 생성이 목적이라 임계치를 두지 않는다.
    // 의도적으로 5xx 를 발생시키므로 http_req_failed 가 0이 아닌 것이 정상이다.
    thresholds: {},
    summaryTrendStats: ['avg', 'min', 'med', 'p(90)', 'p(95)', 'max'],
};

function rnd(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}

function productId() {
    return rnd(1, PRODUCT_MAX);
}

// ─── 시나리오 ────────────────────────────────────────────────

function shopBrowse() {
    http.get(`${SHOP}/shop/products`, { tags: { scenario: 'shop-browse' } });
    http.get(`${SHOP}/shop/products/${productId()}`, { tags: { scenario: 'shop-detail' } });
}

function shopStocks() {
    http.get(`${SHOP}/shop/stocks`, { tags: { scenario: 'shop-stocks' } });
}

function orderList() {
    http.get(`${ORDER}/order/orders`, { tags: { scenario: 'order-list' } });
}

// order-app → shop-app 호출이 일어나 gxid / caller 가 채워진다.
function orderCreate() {
    http.post(
        `${ORDER}/order/orders`,
        { productId: String(productId()), quantity: String(rnd(1, 5)) },
        { tags: { scenario: 'order-create' } },
    );
}

function jitter() {
    http.get(`${SHOP}/shop/lab/jitter?minMs=30&maxMs=2000`, {
        tags: { scenario: 'jitter' },
        timeout: '30s',
    });
}

function literalSql() {
    http.get(`${SHOP}/shop/lab/literal-sql`, { tags: { scenario: 'literal-sql' } });
}

function heavySql() {
    http.get(`${SHOP}/shop/lab/heavy-sql?limit=${rnd(10, 50)}`, { tags: { scenario: 'heavy-sql' } });
}

function orderReport() {
    http.get(`${ORDER}/order/reports/daily`, { tags: { scenario: 'order-report' } });
}

function asyncCall() {
    http.get(`${SHOP}/shop/lab/async`, { tags: { scenario: 'async' } });
}

// 주의: type=http500 은 ResponseStatusException 이라 XLog error 가 0으로 남는다.
// 빨간 점을 만들려면 실제로 예외가 던져지는 npe / illegal 을 써야 한다.
function errorCall() {
    const r = rnd(1, 10);
    if (r <= 6) {
        http.get(`${SHOP}/shop/lab/error?type=npe`, { tags: { scenario: 'error-npe' } });
    } else if (r <= 9) {
        http.get(`${SHOP}/shop/lab/error?type=illegal`, { tags: { scenario: 'error-illegal' } });
    } else {
        http.get(`${ORDER}/order/lab/timeout?ms=6000`, {
            tags: { scenario: 'order-timeout' },
            timeout: '15s',
        });
    }
}

// 누적 가중치 — 합계 100
const MIX = [
    [25, shopBrowse],
    [5, literalSql],
    [10, shopStocks],
    [10, orderList],
    [20, orderCreate],
    [10, jitter],
    [5, heavySql],
    [5, orderReport],
    [5, asyncCall],
    [5, errorCall],
];

export default function () {
    let pick = rnd(1, 100);
    for (const [weight, fn] of MIX) {
        pick -= weight;
        if (pick <= 0) {
            fn();
            break;
        }
    }
    sleep(Math.random() * 0.8 + 0.2);
}
