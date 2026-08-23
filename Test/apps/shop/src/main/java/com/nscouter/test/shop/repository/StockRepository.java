package com.nscouter.test.shop.repository;

import com.nscouter.test.shop.domain.Stock;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface StockRepository extends JpaRepository<Stock, Long> {

    List<Stock> findByProductId(Long productId);
}
