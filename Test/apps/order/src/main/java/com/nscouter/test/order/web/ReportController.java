package com.nscouter.test.order.web;

import com.nscouter.test.order.service.OrderService;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import java.util.ArrayList;
import java.util.List;
import java.util.Map;

@Controller
@RequestMapping("/order/reports")
public class ReportController {

    private final OrderService orderService;

    public ReportController(OrderService orderService) {
        this.orderService = orderService;
    }

    @GetMapping("/daily")
    public String daily(Model model) {
        List<Map<String, Object>> rows = new ArrayList<>();
        for (Object[] r : orderService.dailySummary()) {
            rows.add(Map.of(
                    "status", r[0],
                    "count", r[1],
                    "totalPrice", r[2] == null ? 0 : r[2],
                    "avgQuantity", r[3] == null ? 0 : r[3]
            ));
        }
        model.addAttribute("rows", rows);
        return "reports/daily";
    }
}
