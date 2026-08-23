package com.nscouter.test.shop.repository;

import com.nscouter.test.shop.domain.Product;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface ProductRepository extends JpaRepository<Product, Long> {

    List<Product> findTop50ByOrderByIdDesc();

    List<Product> findByCategory(String category);
}
