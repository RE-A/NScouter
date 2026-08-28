package com.nscouter.test.shop.service;

import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;

import java.util.Map;

/**
 * order-app 호출 담당.
 *
 * **방향이 하나뿐이면 흐름 그림이 한쪽으로만 자란다.** 원래는 order → shop 만 있어서
 * 호출 흐름이 늘 2단이었다. shop → order 를 두면 order → shop → order 로 3단이 되고,
 * 흐름 트리·토폴로지가 실제 운영에서 보게 될 모양에 가까워진다.
 */
@Component
public class OrderClient {

    private final RestClient restClient;

    public OrderClient(RestClient orderRestClient) {
        this.restClient = orderRestClient;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> dailySummary() {
        Map<String, Object> body = restClient.get()
                .uri("/order/api/summary")
                .retrieve()
                .body(Map.class);
        return body == null ? Map.of() : body;
    }
}
