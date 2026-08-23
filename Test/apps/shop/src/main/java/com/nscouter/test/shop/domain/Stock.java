package com.nscouter.test.shop.domain;

import jakarta.persistence.Column;
import jakarta.persistence.Entity;
import jakarta.persistence.GeneratedValue;
import jakarta.persistence.GenerationType;
import jakarta.persistence.Id;
import jakarta.persistence.Table;

@Entity
@Table(name = "stock")
public class Stock {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(name = "product_id", nullable = false)
    private Long productId;

    @Column(nullable = false)
    private int quantity;

    @Column(nullable = false, length = 50)
    private String warehouse;

    protected Stock() {
    }

    public Stock(Long productId, int quantity, String warehouse) {
        this.productId = productId;
        this.quantity = quantity;
        this.warehouse = warehouse;
    }

    public void decrease(int amount) {
        this.quantity = Math.max(0, this.quantity - amount);
    }

    public Long getId() {
        return id;
    }

    public Long getProductId() {
        return productId;
    }

    public int getQuantity() {
        return quantity;
    }

    public String getWarehouse() {
        return warehouse;
    }
}
