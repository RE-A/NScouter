package com.nscouter.test.shop.service;

import com.nscouter.test.shop.domain.Product;
import com.nscouter.test.shop.domain.Stock;
import com.nscouter.test.shop.repository.ProductRepository;
import com.nscouter.test.shop.repository.StockRepository;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.concurrent.CompletableFuture;

@Service
public class LabService {

    private static final Logger log = LoggerFactory.getLogger(LabService.class);

    private final ProductRepository productRepository;
    private final StockRepository stockRepository;

    public LabService(ProductRepository productRepository, StockRepository stockRepository) {
        this.productRepository = productRepository;
        this.stockRepository = stockRepository;
    }

    /**
     * 별도 스레드에서 실행된다. Scouter 는 이런 트랜잭션을 다른 xType 으로 기록하며,
     * NScouter 스캐터에서 회색/연빨강 점으로 표시된다.
     */
    @Async
    public CompletableFuture<Integer> countAsync() {
        try {
            Thread.sleep(120);
        } catch (InterruptedException e) {
            Thread.currentThread().interrupt();
        }
        int total = (int) productRepository.count();
        log.debug("countAsync 완료: {}", total);
        return CompletableFuture.completedFuture(total);
    }

    /**
     * 의도적 N+1. sqlCount / sqlTime 이 커진 XLog 를 만든다.
     */
    public int heavySql(int limit) {
        List<Product> products = productRepository.findTop50ByOrderByIdDesc();
        int sum = 0;
        int handled = 0;
        for (Product p : products) {
            if (handled++ >= limit) {
                break;
            }
            for (Stock s : stockRepository.findByProductId(p.getId())) {
                sum += s.getQuantity();
            }
        }
        return sum;
    }
}
