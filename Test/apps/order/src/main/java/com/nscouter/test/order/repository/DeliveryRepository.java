package com.nscouter.test.order.repository;

import com.nscouter.test.order.domain.Delivery;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DeliveryRepository extends JpaRepository<Delivery, Long> {

    List<Delivery> findByOrderId(Long orderId);

    List<Delivery> findTop50ByOrderByIdDesc();
}
