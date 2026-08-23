package com.nscouter.test.shop.web;

import com.nscouter.test.shop.repository.StockRepository;
import org.springframework.stereotype.Controller;
import org.springframework.ui.Model;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;

import org.springframework.data.domain.PageRequest;

@Controller
@RequestMapping("/shop/stocks")
public class StockController {

    private final StockRepository stockRepository;

    public StockController(StockRepository stockRepository) {
        this.stockRepository = stockRepository;
    }

    @GetMapping
    public String list(Model model) {
        model.addAttribute("stocks", stockRepository.findAll(PageRequest.of(0, 50)).getContent());
        model.addAttribute("total", stockRepository.count());
        return "stocks/list";
    }
}
