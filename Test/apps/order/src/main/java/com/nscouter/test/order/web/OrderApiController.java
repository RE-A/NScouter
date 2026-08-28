package com.nscouter.test.order.web;

import com.nscouter.test.order.service.PipelineService;
import com.nscouter.test.order.service.OrderService;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

/**
 * 앱 간 호출용 JSON API.
 *
 * `/order/reports/daily` 는 Thymeleaf 화면이라 다른 앱이 부르기 어렵다.
 * 같은 질의를 JSON 으로 내는 입구를 따로 둔다.
 */
@RestController
@RequestMapping("/order/api")
public class OrderApiController {

    private final OrderService orderService;
    private final PipelineService pipelineService;

    public OrderApiController(OrderService orderService, PipelineService pipelineService) {
        this.orderService = orderService;
        this.pipelineService = pipelineService;
    }

    /** 상태별 주문 집계. shop-app 의 대시보드가 이걸 부른다 */
    @GetMapping("/summary")
    public Map<String, Object> summary() {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Object[] r : orderService.dailySummary()) {
            rows.add(Map.of(
                    "status", r[0],
                    "count", r[1],
                    "totalPrice", r[2] == null ? 0 : r[2],
                    "avgQuantity", r[3] == null ? 0 : r[3]));
        }
        return Map.of("rows", rows);
    }

    /**
     * 여러 단계를 거치는 요청.
     *
     * order → shop(대시보드) → order(요약) 로 **3단**이 된다.
     * 흐름 트리·토폴로지가 한쪽으로만 자라지 않는지 볼 거리다.
     */
    @GetMapping("/pipeline")
    public Map<String, Object> pipeline(@RequestParam(defaultValue = "3") int categories) {
        return pipelineService.run(Math.min(Math.max(categories, 1), 8));
    }
}
