package com.nscouter.test.shop.service;

import com.nscouter.test.shop.domain.AuditLog;
import com.nscouter.test.shop.domain.Product;
import com.nscouter.test.shop.domain.Stock;
import com.nscouter.test.shop.repository.AuditLogRepository;
import com.nscouter.test.shop.repository.ProductRepository;
import com.nscouter.test.shop.repository.StockRepository;
import jakarta.persistence.EntityManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 한 요청 안에서 **여러 종류의 SQL 과 앱 간 호출**이 섞이는 흐름.
 *
 * 그전 테스트 앱은 요청 하나가 쿼리 한두 개로 끝나서, 프로파일 화면에서
 * 확인할 수 있는 게 거의 없었다 — 요약 표는 줄이 두어 개였고, 흐름 트리는
 * 늘 같은 모양이었으며, 프로파일 검색은 찾을 거리가 없었다.
 *
 * 여기서 만드는 모양:
 *   집계(GROUP BY) → 조인+서브쿼리 → 카테고리별 N+1 → 다른 앱 호출 → INSERT + 커밋
 *
 * 메서드가 여러 겹이라 Method 스텝도 계단으로 쌓인다
 * (에이전트 `hook_method_patterns` 가 service/repository 를 잡는다).
 */
@Service
public class DashboardService {

    private static final Logger log = LoggerFactory.getLogger(DashboardService.class);

    private final ProductRepository productRepository;
    private final StockRepository stockRepository;
    private final AuditLogRepository auditLogRepository;
    private final OrderClient orderClient;
    private final EntityManager entityManager;

    public DashboardService(ProductRepository productRepository,
                            StockRepository stockRepository,
                            AuditLogRepository auditLogRepository,
                            OrderClient orderClient,
                            EntityManager entityManager) {
        this.productRepository = productRepository;
        this.stockRepository = stockRepository;
        this.auditLogRepository = auditLogRepository;
        this.orderClient = orderClient;
        this.entityManager = entityManager;
    }

    /**
     * 대시보드 한 판.
     *
     * **트랜잭션 하나로 묶는다.** 읽기만 하는 요청은 커밋이 없어서 프로파일에
     * `setAutoCommit(false) … COMMIT` 계단이 나오지 않는다 — 운영에서 가장 흔한 모양인데.
     */
    @Transactional
    public Map<String, Object> build(int categoryLimit) {
        Map<String, Object> out = new LinkedHashMap<>();

        out.put("categories", categorySummary());
        out.put("lowStock", lowStockJoin());
        out.put("perCategory", perCategoryDetail(categoryLimit));   // 여기서 N+1
        out.put("orders", orderSummary());                          // 다른 앱

        auditLogRepository.save(new AuditLog("dashboard", "categories=" + categoryLimit));
        return out;
    }

    /** 1) 집계 — GROUP BY / HAVING */
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> categorySummary() {
        List<Object[]> rows = entityManager.createNativeQuery(
                        "select p.category, count(*) as cnt, avg(p.price) as avg_price,"
                                + " max(p.price) as max_price"
                                + " from product p"
                                + " group by p.category"
                                + " having count(*) > ?"
                                + " order by cnt desc")
                .setParameter(1, 0)
                .getResultList();

        List<Map<String, Object>> out = new ArrayList<>();
        for (Object[] r : rows) {
            out.add(Map.of(
                    "category", r[0],
                    "count", ((Number) r[1]).intValue(),
                    "avgPrice", ((Number) r[2]).intValue(),
                    "maxPrice", ((Number) r[3]).intValue()));
        }
        return out;
    }

    /** 2) 조인 + 서브쿼리 — 재고가 평균보다 적은 상품 */
    @SuppressWarnings("unchecked")
    List<Map<String, Object>> lowStockJoin() {
        List<Object[]> rows = entityManager.createNativeQuery(
                        "select p.id, p.name, s.warehouse, s.quantity"
                                + " from product p"
                                + " join stock s on s.product_id = p.id"
                                + " where s.quantity < (select avg(quantity) from stock)"
                                + " order by s.quantity asc"
                                + " limit ?")
                .setParameter(1, 20)
                .getResultList();

        List<Map<String, Object>> out = new ArrayList<>();
        for (Object[] r : rows) {
            out.add(Map.of(
                    "productId", ((Number) r[0]).longValue(),
                    "name", r[1],
                    "warehouse", r[2],
                    "quantity", ((Number) r[3]).intValue()));
        }
        return out;
    }

    /**
     * 3) 카테고리별로 상품을 읽고, 상품마다 재고를 또 읽는다.
     *
     * **의도한 N+1 이다.** 요약 표에서 "같은 SQL 이 50번" 이 어떻게 보이는지,
     * 흐름 트리가 그걸 한 줄로 접어 `×50` 으로 보여 주는지 확인할 거리가 필요하다.
     */
    List<Map<String, Object>> perCategoryDetail(int categoryLimit) {
        List<Map<String, Object>> categories = categorySummary();
        List<Map<String, Object>> out = new ArrayList<>();

        int handled = 0;
        for (Map<String, Object> c : categories) {
            if (handled++ >= categoryLimit) {
                break;
            }
            String category = String.valueOf(c.get("category"));
            List<Product> products = productRepository.findByCategory(category);

            int totalQuantity = 0;
            for (Product p : products) {
                for (Stock s : stockRepository.findByProductId(p.getId())) {
                    totalQuantity += s.getQuantity();
                }
            }
            out.add(Map.of(
                    "category", category,
                    "products", products.size(),
                    "totalQuantity", totalQuantity));
        }
        return out;
    }

    /** 4) 다른 앱 호출 — 여기서 gxid 가 order-app 으로 이어진다 */
    Map<String, Object> orderSummary() {
        try {
            return orderClient.dailySummary();
        } catch (RuntimeException e) {
            // **호출이 실패해도 대시보드는 그린다.** 한 곳이 죽었다고 화면 전체가
            // 사라지면 무엇이 죽었는지도 못 본다.
            log.warn("order-app 요약 조회 실패: {}", e.toString());
            return Map.of("error", e.getClass().getSimpleName());
        }
    }
}
