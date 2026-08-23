package com.nscouter.test.order.web;

import com.nscouter.test.order.service.ShopClient;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.Map;

@RestController
@RequestMapping("/order/lab")
public class LabController {

    private final ShopClient shopClient;

    public LabController(ShopClient shopClient) {
        this.shopClient = shopClient;
    }

    /**
     * shop-app 을 읽기 타임아웃(3초)보다 오래 걸리게 호출한다.
     * 두 앱 모두에서 XLog 가 생성되며 order-app 쪽은 에러로 기록된다.
     */
    @GetMapping("/timeout")
    public Map<String, Object> timeout(@RequestParam(defaultValue = "6000") long ms) {
        return shopClient.callSlow(ms);
    }
}
