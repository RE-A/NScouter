package com.nscouter.test.order.service;

import com.nscouter.test.order.domain.Delivery;
import com.nscouter.test.order.repository.DeliveryRepository;
import jakarta.persistence.EntityManager;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

/**
 * 여러 단계를 거치는 주문 처리.
 *
 * 한 요청 안에서 **읽기 → 다른 앱 호출 → 쓰기 → 커밋** 이 이어진다.
 * 그전에는 order-app 의 요청이 대부분 select 한두 개로 끝나서,
 * 상세 화면의 프로파일이 늘 다섯 줄이었다.
 */
@Service
public class PipelineService {

    private static final Logger log = LoggerFactory.getLogger(PipelineService.class);

    private final DeliveryRepository deliveryRepository;
    private final ShopClient shopClient;
    private final EntityManager entityManager;

    public PipelineService(DeliveryRepository deliveryRepository,
                           ShopClient shopClient,
                           EntityManager entityManager) {
        this.deliveryRepository = deliveryRepository;
        this.shopClient = shopClient;
        this.entityManager = entityManager;
    }

    @Transactional
    public Map<String, Object> run(int categories) {
        Map<String, Object> out = new LinkedHashMap<>();

        out.put("pending", countPending());
        out.put("recent", recentJoin());
        out.put("shop", shopDashboard(categories));   // 여기서 3단이 된다
        out.put("touched", touchDeliveries());

        return out;
    }

    /** 1) 집계 */
    long countPending() {
        Number n = (Number) entityManager.createNativeQuery(
                        "select count(*) from orders o where o.status = ?")
                .setParameter(1, "PENDING")
                .getSingleResult();
        return n.longValue();
    }

    /** 2) 조인 — 최근 주문과 배송 상태 */
    @SuppressWarnings("unchecked")
    List<Object[]> recentJoin() {
        return entityManager.createNativeQuery(
                        "select o.id, o.product_name, o.status, d.status, d.address"
                                + " from orders o"
                                + " left join delivery d on d.order_id = o.id"
                                + " order by o.ordered_at desc"
                                + " limit ?")
                .setParameter(1, 15)
                .getResultList();
    }

    /** 3) shop-app 대시보드 호출 — 그 안에서 다시 order-app 을 부른다 */
    Map<String, Object> shopDashboard(int categories) {
        try {
            return shopClient.dashboard(categories);
        } catch (RuntimeException e) {
            log.warn("shop-app 대시보드 호출 실패: {}", e.toString());
            return Map.of("error", e.getClass().getSimpleName());
        }
    }

    /**
     * 4) 쓰기 + 커밋.
     *
     * 값을 실제로 바꾸지는 않는다(같은 상태로 다시 저장). 데이터를 흔들지 않으면서
     * UPDATE 스텝과 커밋만 만들려는 것이다.
     */
    int touchDeliveries() {
        List<Delivery> rows = deliveryRepository.findAll(
                org.springframework.data.domain.PageRequest.of(0, 5)).getContent();
        // 값을 그대로 다시 저장한다. Hibernate 는 더티 체킹으로 UPDATE 를 내지 않을 수 있어
        // 네이티브 UPDATE 로 확실히 한 번 쓴다 — 프로파일에 쓰기 스텝이 있어야 한다.
        int touched = 0;
        for (Delivery d : rows) {
            touched += entityManager.createNativeQuery(
                            "update delivery set status = ? where id = ?")
                    .setParameter(1, d.getStatus())
                    .setParameter(2, d.getId())
                    .executeUpdate();
        }
        return touched;
    }
}
