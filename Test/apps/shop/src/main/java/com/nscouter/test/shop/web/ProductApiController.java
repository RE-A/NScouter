package com.nscouter.test.shop.web;

import com.nscouter.test.shop.domain.Product;
import com.nscouter.test.shop.domain.Stock;
import com.nscouter.test.shop.repository.ProductRepository;
import com.nscouter.test.shop.repository.StockRepository;
import org.springframework.http.HttpStatus;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.server.ResponseStatusException;

import java.util.List;
import java.util.Map;

/**
 * order-app 이 호출하는 내부 REST.
 * 이 호출이 있어야 XLogPack 의 gxid / caller 와 apicall 프로파일 스텝이 생성된다.
 */
@RestController
@RequestMapping("/shop/api")
public class ProductApiController {

    private final ProductRepository productRepository;
    private final StockRepository stockRepository;

    public ProductApiController(ProductRepository productRepository, StockRepository stockRepository) {
        this.productRepository = productRepository;
        this.stockRepository = stockRepository;
    }

    @GetMapping("/products/{id}")
    public Map<String, Object> get(@PathVariable Long id) {
        Product product = productRepository.findById(id)
                .orElseThrow(() -> new ResponseStatusException(HttpStatus.NOT_FOUND, "상품 없음: " + id));

        List<Stock> stocks = stockRepository.findByProductId(id);
        int available = stocks.stream().mapToInt(Stock::getQuantity).sum();

        return Map.of(
                "id", product.getId(),
                "name", product.getName(),
                "category", product.getCategory(),
                "price", product.getPrice(),
                "availableQuantity", available
        );
    }

    @GetMapping("/products/count")
    public Map<String, Object> count() {
        return Map.of("count", productRepository.count());
    }
}
