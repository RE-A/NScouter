package com.nscouter.test.order.web;

import com.nscouter.test.order.repository.DeliveryRepository;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;

@Controller
@RequestMapping("/order/deliveries")
public class DeliveryController {

    private final DeliveryRepository deliveryRepository;

    public DeliveryController(DeliveryRepository deliveryRepository) {
        this.deliveryRepository = deliveryRepository;
    }

    @GetMapping
    public String list(Model model) {
        model.addAttribute("deliveries", deliveryRepository.findTop50ByOrderByIdDesc());
        model.addAttribute("total", deliveryRepository.count());
        return "deliveries/list";
    }
}
