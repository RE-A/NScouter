package com.nscouter.test.order.service;

import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Component;
import org.springframework.web.client.RestClient;
import org.springframework.web.server.ResponseStatusException;

import java.util.Map;

/**
 * shop-app 호출 담당.
 * Scouter 는 이 HTTP 호출을 apicall 프로파일 스텝으로 기록하고,
 * 호출 헤더로 gxid 를 전파해 두 앱의 XLog 를 하나의 트랜잭션으로 묶는다.
 */
@Component
public class ShopClient {

    private final RestClient restClient;

    public ShopClient(RestClient shopRestClient) {
        this.restClient = shopRestClient;
    }

    @SuppressWarnings("unchecked")
    public Map<String, Object> getProduct(long productId) {
        Map<String, Object> body = restClient.get()
                .uri("/shop/api/products/{id}", productId)
                .retrieve()
                .onStatus(status -> status.value() == 404, (req, res) -> {
                    throw new ResponseStatusException(HttpStatus.BAD_REQUEST,
                            "shop-app 에 상품이 없습니다: " + productId);
                })
                .body(Map.class);

        if (body == null) {
            throw new ResponseStatusException(HttpStatus.BAD_GATEWAY, "shop-app 응답 본문 없음");
        }
        return body;
    }

    /** 읽기 타임아웃(3초)을 넘기는 호출. 타임아웃 에러 XLog 를 만든다. */
    public Map<String, Object> callSlow(long ms) {
        return restClient.get()
                .uri("/shop/lab/slow?ms={ms}", ms)
                .retrieve()
                .body(Map.class);
    }
}
