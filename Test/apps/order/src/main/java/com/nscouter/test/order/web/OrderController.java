package com.nscouter.test.order.web;

import com.nscouter.test.order.domain.Order;
import com.nscouter.test.order.repository.DeliveryRepository;
import com.nscouter.test.order.repository.OrderRepository;
import com.nscouter.test.order.service.OrderService;
import org.springframework.http.HttpStatus;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.server.ResponseStatusException;

@Controller
@RequestMapping("/order/orders")
public class OrderController {

    private final OrderRepository orderRepository;
    private final DeliveryRepository deliveryRepository;
    private final OrderService orderService;

    public OrderController(OrderRepository orderRepository,
                           DeliveryRepository deliveryRepository,
                           OrderService orderService) {
        this.orderRepository = orderRepository;
        this.deliveryRepository = deliveryRepository;
        this.orderService = orderService;
    }

    @GetMapping
    public String list(Model model) {
        model.addAttribute("orders", orderRepository.findTop50ByOrderByIdDesc());
        model.addAttribute("total", orderRepository.count());
        return "orders/list";
    }

    @GetMapping("/new")
    public String newForm() {
        return "orders/form";
    }

    @PostMapping
    public String create(@RequestParam long productId,
                         @RequestParam(defaultValue = "1") int quantity) {
        Order order = orderService.create(productId, Math.max(1, quantity));
        return "redirect:/order/orders/" + order.getId();
    }

    @GetMapping("/{id}")
    public String detail(@PathVariable Long id, Model model) {
        Order order = orderRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "주문 없음: " + id));
        model.addAttribute("order", order);
        model.addAttribute("deliveries", deliveryRepository.findByOrderId(id));
        return "orders/detail";
    }

    @PostMapping("/{id}/cancel")
    public String cancel(@PathVariable Long id) {
        orderService.cancel(id);
        return "redirect:/order/orders/" + id;
    }
}
