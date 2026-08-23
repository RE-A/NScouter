package com.nscouter.test.order.service;

import com.nscouter.test.order.domain.Delivery;
import com.nscouter.test.order.domain.Order;
import com.nscouter.test.order.repository.DeliveryRepository;
import com.nscouter.test.order.repository.OrderRepository;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

@Service
public class OrderService {

    private static final String[] ADDRESSES = {
            "서울시 강남구", "부산시 해운대구", "대전시 유성구", "광주시 서구", "인천시 연수구"
    };

    private final OrderRepository orderRepository;
    private final DeliveryRepository deliveryRepository;
    private final ShopClient shopClient;

    public OrderService(OrderRepository orderRepository,
                        DeliveryRepository deliveryRepository,
                        ShopClient shopClient) {
        this.orderRepository = orderRepository;
        this.deliveryRepository = deliveryRepository;
        this.shopClient = shopClient;
    }

    /**
     * 주문 생성. shop-app 을 먼저 호출해 상품 정보를 가져온 뒤 저장한다.
     * 이 호출 때문에 XLogPack 의 gxid / caller 가 채워진다.
     */
    @Transactional
    public Order create(long productId, int quantity) {
        Map<String, Object> product = shopClient.getProduct(productId);

        String name = String.valueOf(product.get("name"));
        int price = ((Number) product.get("price")).intValue();

        Order order = orderRepository.save(new Order(productId, name, quantity, price));
        deliveryRepository.save(new Delivery(order.getId(),
                ADDRESSES[(int) (order.getId() % ADDRESSES.length)]));
        return order;
    }

    @Transactional
    public void cancel(long orderId) {
        Order order = orderRepository.findById(orderId)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "주문 없음: " + orderId));
        order.cancel();
        orderRepository.save(order);

        List<Delivery> deliveries = deliveryRepository.findByOrderId(orderId);
        for (Delivery d : deliveries) {
            d.cancel();
        }
        deliveryRepository.saveAll(deliveries);
    }

    @Transactional(readOnly = true)
    public List<Object[]> dailySummary() {
        return orderRepository.summarizeByStatus();
    }
}
